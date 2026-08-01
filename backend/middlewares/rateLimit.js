const rateLimit = require('express-rate-limit');

const json = (message) => (req, res) => res.status(429).json({ error: message });

// Admin login: slows down online password guessing. Counts only failures so a
// busy office of legitimate admins is never locked out.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LOGIN || 10),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many failed sign-in attempts. Please try again in a few minutes.'),
});

// Public application form: stops scripted flooding of the applicant table.
const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_APPLY || 15),
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many applications submitted from this network. Please try again later.'),
});

// Requesting a reset code: each call sends an email, so it is both a spam
// vector and a way to probe which addresses exist. Counts every call.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PASSWORD_RESET || 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many password reset requests. Please try again in a few minutes.'),
});

// Redeeming a code needs its own budget. Sharing one with the request endpoint
// meant a user who pressed "resend" twice could no longer use the code they
// were sent. Only failures count, so a correct code is never blocked.
const passwordResetRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PASSWORD_REDEEM || 15),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many incorrect codes. Please request a new one in a few minutes.'),
});

// Two-factor codes: 6 digits is only 1,000,000 combinations, so the number of
// guesses per challenge has to be capped.
const totpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_TOTP || 12),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many incorrect codes. Please wait a few minutes and sign in again.'),
});

// Everything else on the public API - generous, only catches abuse
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PUBLIC || 300),
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many requests. Please slow down.'),
});

module.exports = {
  loginLimiter,
  applyLimiter,
  publicLimiter,
  passwordResetLimiter,
  passwordResetRedeemLimiter,
  totpLimiter,
};
