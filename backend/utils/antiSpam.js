// Defences for the one endpoint that writes on behalf of the public.
//
// Each of these catches something the others do not, and none of them asks a
// real applicant to do anything:
//
//   honeypot     - a field a human never sees and a form-filling bot always
//                  completes
//   form token   - proves the form was actually fetched, and that submitting it
//                  took a human amount of time
//   PDF sniffing - the declared MIME type is written by the uploader; the bytes
//                  are not
//   applicant cap- one person applying to every vacancy in the group inside an
//                  hour is a script, whatever the per-position rule says
//
// The captcha and the API key sit in front of all of it; these are what remain
// standing when a caller has satisfied both.

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Honeypot

// Named to look like something worth filling in. Real forms render it hidden;
// a bot parsing the DOM has no way to know it should be left alone.
const HONEYPOT_FIELD = 'company_website';

const honeypotTripped = (body) => String(body?.[HONEYPOT_FIELD] || '').trim().length > 0;

// ---------------------------------------------------------------------------
// Form token
//
// A signed timestamp handed out by GET /api/form-token. It proves two things a
// browser can prove and a script usually does not bother to: that the form was
// actually loaded from us, and that a human-plausible amount of time passed
// between loading it and submitting it.
//
// Signed with JWT_SECRET, which the process already refuses to start without.

const MIN_FILL_SECONDS = Number(process.env.FORM_MIN_SECONDS || 3);
const MAX_FORM_AGE_SECONDS = Number(process.env.FORM_MAX_SECONDS || 2 * 60 * 60);

const sign = (value) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(value)).digest('hex');

function issueFormToken() {
  const issuedAt = Date.now();
  return { token: `${issuedAt}.${sign(issuedAt)}`, issued_at: issuedAt, min_seconds: MIN_FILL_SECONDS };
}

// { ok: true } or { ok: false, reason }
function verifyFormToken(token) {
  const raw = String(token || '');
  if (!raw) return { ok: false, reason: 'missing' };

  const [issuedAt, signature] = raw.split('.');
  if (!issuedAt || !signature) return { ok: false, reason: 'malformed' };

  const expected = sign(issuedAt);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const ageSeconds = (Date.now() - Number(issuedAt)) / 1000;
  // A token from the future is a tampered clock or a replayed value
  if (ageSeconds < 0) return { ok: false, reason: 'not_yet_valid' };
  if (ageSeconds < MIN_FILL_SECONDS) return { ok: false, reason: 'too_fast' };
  if (ageSeconds > MAX_FORM_AGE_SECONDS) return { ok: false, reason: 'expired' };

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Resume sniffing
//
// `resume.mimetype` is whatever the uploading client wrote in the multipart
// headers, so on its own it proves nothing at all. A PDF starts with "%PDF-";
// the standard tolerates a little junk in front of it, so the first kilobyte is
// searched rather than only the first five bytes.

const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');

function looksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PDF_SIGNATURE.length) return false;
  return buffer.subarray(0, 1024).includes(PDF_SIGNATURE);
}

// ---------------------------------------------------------------------------
// Per-applicant cap
//
// The unique index stops the same number applying twice for one position. It
// does nothing about a script walking the whole vacancy list once, which is
// what a real flood looks like. This caps how many positions one person can
// apply for in a rolling day - generous for a genuine job hunt, useless for a
// script.

const MAX_PER_APPLICANT_PER_DAY = Number(process.env.MAX_APPLICATIONS_PER_DAY || 8);

async function applicantOverDailyCap(db, { mobile, email }) {
  if (MAX_PER_APPLICANT_PER_DAY <= 0) return false; // 0 disables the cap
  const row = await db.get(
    `SELECT COUNT(*) AS count FROM applications
      WHERE created_at > now() - interval '24 hours'
        AND (mobile = ? OR LOWER(email) = LOWER(?))`,
    mobile,
    email
  );
  return Number(row.count) >= MAX_PER_APPLICANT_PER_DAY;
}

// ---------------------------------------------------------------------------
// Deployment posture
//
// Reported at boot: with no captcha, no key requirement and no form token
// requirement, the write path is protected by rate limiting alone.
const writePathIsOpen = () =>
  !process.env.TURNSTILE_SECRET_KEY &&
  String(process.env.REQUIRE_API_KEY || '').toLowerCase() !== 'true' &&
  String(process.env.REQUIRE_FORM_TOKEN || '').toLowerCase() !== 'true';

const requireApiKey = () => String(process.env.REQUIRE_API_KEY || '').toLowerCase() === 'true';
const requireFormToken = () =>
  String(process.env.REQUIRE_FORM_TOKEN || '').toLowerCase() === 'true';

module.exports = {
  HONEYPOT_FIELD,
  honeypotTripped,
  issueFormToken,
  verifyFormToken,
  looksLikePdf,
  applicantOverDailyCap,
  writePathIsOpen,
  requireApiKey,
  requireFormToken,
  MAX_PER_APPLICANT_PER_DAY,
  MIN_FILL_SECONDS,
};
