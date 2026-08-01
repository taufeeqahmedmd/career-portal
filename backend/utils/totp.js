// Time-based one-time passwords (RFC 6238 / RFC 4226) over HMAC-SHA1 - the
// algorithm every authenticator app implements: Google Authenticator, Microsoft
// Authenticator, Authy, 1Password. Hand-rolled on node:crypto so the portal
// carries no extra runtime dependency for it.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32
const STEP_SECONDS = 30;
const DIGITS = 6;
// How many 30s steps either side of "now" are accepted, to tolerate a phone
// clock that drifts by a few seconds.
const DEFAULT_WINDOW = 1;

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of String(input || '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue; // ignore spaces, padding and separators
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1
const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretBuffer, counter) {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter % 2 ** 32, 4);

  const digest = crypto.createHmac('sha1', secretBuffer).update(message).digest();
  // Dynamic truncation - the low nibble of the last byte picks the offset
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

const stepFor = (seconds) => Math.floor(seconds / STEP_SECONDS);

// Current code for a secret. Exported for tests and for the seeding scripts.
function generate(secret, atSeconds = Math.floor(Date.now() / 1000)) {
  return hotp(base32Decode(secret), stepFor(atSeconds));
}

// Returns the matched time step (so callers can block replay) or null.
// Comparison is constant-time to keep the check free of timing signal.
function verify(secret, token, { window = DEFAULT_WINDOW, atSeconds } = {}) {
  const code = String(token || '').replace(/\D/g, '');
  if (code.length !== DIGITS) return null;

  const secretBuffer = base32Decode(secret);
  if (!secretBuffer.length) return null;

  const current = stepFor(atSeconds == null ? Math.floor(Date.now() / 1000) : atSeconds);
  const candidate = Buffer.from(code);

  for (let drift = -window; drift <= window; drift += 1) {
    const step = current + drift;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secretBuffer, step));
    if (expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)) {
      return step;
    }
  }
  return null;
}

// The otpauth:// URI an authenticator app reads out of the enrolment QR code
function otpauthUrl({ secret, account, issuer = 'Careers Portal' }) {
  // Built by hand rather than with URLSearchParams: that encodes a space as
  // "+", and some authenticator apps show the plus sign literally.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = [
    `secret=${encodeURIComponent(secret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    `digits=${DIGITS}`,
    `period=${STEP_SECONDS}`,
  ].join('&');
  return `otpauth://totp/${label}?${query}`;
}

module.exports = {
  generateSecret,
  generate,
  verify,
  otpauthUrl,
  base32Encode,
  base32Decode,
  STEP_SECONDS,
  DIGITS,
};
