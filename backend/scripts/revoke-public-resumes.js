// One-off: removes "anyone with the link can view" from every resume already in
// the Drive folder.
//
// Uploads used to be shared publicly so the admin panel could embed the Drive
// URL directly. That put each candidate's name, phone, email and history behind
// an unauthenticated link that works forever and is trivially forwarded.
// Resumes are now streamed through GET /api/admin/applications/:id/resume, so
// the public permission is no longer needed - and the files already uploaded
// still carry it until this runs.
//
//   node scripts/revoke-public-resumes.js          # report only
//   node scripts/revoke-public-resumes.js --apply  # actually revoke
require('dotenv').config();
const { google } = require('googleapis');

const APPLY = process.argv.includes('--apply');

function getDrive() {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN } =
    process.env;
  if (GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN) {
    const auth = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });
    return google.drive({ version: 'v3', auth });
  }
  throw new Error('Google OAuth credentials are not configured.');
}

(async () => {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set.');

  const drive = getDrive();
  const files = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  console.log(`Scanning ${files.length} file(s) in the resumes folder...\n`);

  let publicCount = 0;
  let revoked = 0;
  const domainShared = new Set();

  for (const file of files) {
    const { data } = await drive.permissions.list({
      fileId: file.id,
      fields: 'permissions(id, type, role, domain)',
      supportsAllDrives: true,
    });
    const permissions = data.permissions || [];

    // Only "anyone" is removed. That is the link-sharing grant this application
    // used to add, and it is what makes a resume readable by the whole internet.
    // A "domain" grant comes from how the folder itself is shared - an
    // organisation decision, not something this app set, so it is reported
    // rather than changed.
    permissions.filter((p) => p.type === 'domain').forEach((p) => domainShared.add(p.domain));
    const open = permissions.filter((p) => p.type === 'anyone');
    if (!open.length) continue;

    publicCount += 1;
    console.log(`  ${file.name}`);
    console.log(`    public link: ${open.map((p) => `anyone/${p.role}`).join(', ')}`);

    if (!APPLY) continue;
    for (const permission of open) {
      try {
        await drive.permissions.delete({
          fileId: file.id,
          permissionId: permission.id,
          supportsAllDrives: true,
        });
        revoked += 1;
        console.log('    -> revoked');
      } catch (err) {
        console.log(`    -> could not revoke: ${err.message}`);
      }
    }
  }

  console.log('');
  if (!publicCount) {
    console.log('No publicly linked resumes found. Nothing to do.');
  } else if (APPLY) {
    console.log(`Revoked ${revoked} public link permission(s) across ${publicCount} file(s).`);
    console.log('Admins read resumes through the portal; the Drive links are no longer public.');
  } else {
    console.log(`${publicCount} file(s) are readable by anyone with the link.`);
    console.log('Re-run with --apply to revoke that.');
  }

  if (domainShared.size) {
    console.log('');
    console.log(`Note: these files are also visible to everyone at ${[...domainShared].join(', ')},`);
    console.log('inherited from how the Drive folder itself is shared. That is your');
    console.log('organisation\'s setting, so this script leaves it alone - but it does mean');
    console.log('every staff member with a domain account can browse candidate resumes.');
  }
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
