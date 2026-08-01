const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

// Resumes are uploaded to Google Drive when credentials are configured.
// Without credentials we fall back to local disk (backend/uploads/resumes)
// so the form keeps working in development.
//
// Two auth modes (OAuth wins when both are set):
//   1. OAuth user account - uploads consume that user's storage quota.
//      GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN
//      (mint the refresh token once with: node scripts/get-google-refresh-token.js)
//   2. Service account - only works with a folder inside a Shared Drive,
//      since service accounts have no storage quota of their own.
//      GOOGLE_SERVICE_ACCOUNT_KEY_FILE (path) or GOOGLE_SERVICE_ACCOUNT_KEY (raw/base64 JSON)
// Both modes need:
//   GOOGLE_DRIVE_FOLDER_ID          Drive folder the resumes are uploaded into

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'resumes');

function loadServiceAccount() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  try {
    if (keyFile && fs.existsSync(keyFile)) {
      return JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    }
    if (keyRaw) {
      const text = keyRaw.trim().startsWith('{')
        ? keyRaw
        : Buffer.from(keyRaw, 'base64').toString('utf8');
      return JSON.parse(text);
    }
  } catch (err) {
    console.error('Could not parse Google service account key:', err.message);
  }
  return null;
}

const hasOAuthConfig = () =>
  !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );

const isDriveConfigured = () =>
  !!((hasOAuthConfig() || loadServiceAccount()) && process.env.GOOGLE_DRIVE_FOLDER_ID);

let driveClient = null;
function getDrive() {
  if (driveClient) return driveClient;
  const { google } = require('googleapis');
  let auth;
  if (hasOAuthConfig()) {
    auth = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  } else {
    auth = new google.auth.GoogleAuth({
      credentials: loadServiceAccount(),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  }
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

// The extension comes from the validated MIME type, never from the uploaded
// filename - a client-supplied ".html" would otherwise be stored and served
// as executable same-origin content.
function safeFileName(applicantName, originalName, ext = '.pdf') {
  const base = String(applicantName || 'resume')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'resume';
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = crypto.randomBytes(4).toString('hex');
  return `${base}_${stamp}_${rand}${ext}`;
}

async function uploadToDrive(file, applicantName, ext) {
  const drive = getDrive();
  const name = safeFileName(applicantName, file.originalname, ext);

  const { data } = await drive.files.create({
    requestBody: {
      name,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    media: {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer),
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  // Deliberately NOT shared with "anyone with the link". A resume carries the
  // candidate's name, phone, email and history; a public URL would put all of
  // that one forwarded link away from anybody, permanently and unaudited.
  // Admins read it through GET /api/admin/applications/:id/resume, which
  // streams the file only to a signed-in user whose scope covers the applicant.
  return { fileId: data.id, link: data.webViewLink };
}

// Streams a stored resume back. Returns { stream, mimeType, size } or throws.
async function openDriveFile(fileId) {
  const drive = getDrive();
  const meta = await drive.files.get({
    fileId,
    fields: 'mimeType, size, name',
    supportsAllDrives: true,
  });
  const media = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return {
    stream: media.data,
    mimeType: meta.data.mimeType || 'application/octet-stream',
    size: meta.data.size,
    name: meta.data.name,
  };
}

function uploadToLocal(file, applicantName, ext) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const name = safeFileName(applicantName, file.originalname, ext);
  fs.writeFileSync(path.join(UPLOADS_DIR, name), file.buffer);
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  return { fileId: '', link: `${base}/api/files/resumes/${name}` };
}

// Returns { fileId, link } or throws with a user-safe message.
// `ext` is derived by the caller from the validated MIME type.
async function storeResume(file, applicantName, ext = '.pdf') {
  if (isDriveConfigured()) {
    try {
      return await uploadToDrive(file, applicantName, ext);
    } catch (err) {
      console.error('Google Drive upload failed:', err.message);
      // Do not lose the resume if Drive is briefly down - keep a local copy
      return uploadToLocal(file, applicantName, ext);
    }
  }
  console.warn('Google Drive not configured - storing resume locally.');
  return uploadToLocal(file, applicantName, ext);
}

// Removes a resume that was stored but whose application row never landed, so
// a rejected or failed submission does not leave a file behind. Best effort:
// failing to clean up must never turn into the error the applicant sees.
async function discardStoredResume(stored) {
  if (!stored) return;
  try {
    if (stored.fileId) {
      await getDrive().files.delete({ fileId: stored.fileId, supportsAllDrives: true });
      return;
    }
    if (stored.link) {
      const name = path.basename(stored.link);
      const target = path.join(UPLOADS_DIR, name);
      // Guard against a crafted link pointing outside the uploads directory
      if (path.dirname(path.resolve(target)) === path.resolve(UPLOADS_DIR)) {
        fs.rmSync(target, { force: true });
      }
    }
  } catch (err) {
    console.error('Could not remove the orphaned resume:', err.message);
  }
}

// Resolves a stored resume to a readable local path, or null when it is not a
// local file. The filename is taken from the link and confined to the uploads
// directory so a crafted value cannot escape it.
function localResumePath(link) {
  if (!link) return null;
  const name = path.basename(String(link));
  if (!name || name.includes('/') || name.includes('\\')) return null;
  const target = path.resolve(UPLOADS_DIR, name);
  if (path.dirname(target) !== path.resolve(UPLOADS_DIR)) return null;
  return fs.existsSync(target) ? target : null;
}

module.exports = {
  storeResume,
  discardStoredResume,
  openDriveFile,
  localResumePath,
  isDriveConfigured,
  UPLOADS_DIR,
};
