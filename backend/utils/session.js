// Session and sign-in-challenge tokens, and the one rule that revokes them.
//
// JWT's standard `iat` claim has whole-second resolution, which is too coarse:
// a token minted in the same second as a password change would survive it. Both
// token types therefore carry a millisecond `ms` claim and are compared against
// `users.password_changed_at` at millisecond precision.
const jwt = require('jsonwebtoken');

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);
// Long enough to open an authenticator app and read a code, short enough that a
// half-finished sign-in is not a standing key to the account
const CHALLENGE_MINUTES = Number(process.env.TOTP_CHALLENGE_MINUTES || 10);

const issueSessionToken = (userId) =>
  jwt.sign({ id: userId, stage: 'session', ms: Date.now() }, process.env.JWT_SECRET, {
    expiresIn: `${SESSION_HOURS}h`,
  });

const issueChallengeToken = (userId, setup) =>
  jwt.sign(
    { id: userId, stage: 'totp', setup: !!setup, ms: Date.now() },
    process.env.JWT_SECRET,
    { expiresIn: `${CHALLENGE_MINUTES}m` }
  );

// True when the token was minted before the account's password last changed.
// Applies to challenge tokens as much as session tokens: a challenge is half of
// a completed password check, so it has to die with that password.
function predatesPasswordChange(payload, passwordChangedAt) {
  if (!passwordChangedAt) return false;
  const changedAtMs = new Date(passwordChangedAt).getTime();
  if (!Number.isFinite(changedAtMs)) return false;

  if (typeof payload.ms === 'number') return payload.ms < changedAtMs;
  // Tokens issued before the `ms` claim existed: fall back to whole seconds
  if (typeof payload.iat === 'number') return payload.iat * 1000 < changedAtMs;
  // No timestamp at all - it cannot be shown to be current, so it is not
  return true;
}

module.exports = {
  issueSessionToken,
  issueChallengeToken,
  predatesPasswordChange,
  SESSION_HOURS,
  CHALLENGE_MINUTES,
};
