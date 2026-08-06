const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { fail, oneError, CODES } = require('../utils/errors');

const json = (message) => (req, res) => res.status(429).json({ error: message });

// Public endpoints answer in the field-error shape partners integrate against
const limited = (message) => (req, res) =>
  fail(res, 429, oneError('request', CODES.RATE_LIMITED, message));

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
//
// Anonymous callers are counted per IP, which is right for a browser form: one
// applicant, one network, a handful of submissions. It is wrong for a partner
// site that posts from its own server, where every application in the group
// arrives from a single address and would exhaust one IP's budget in an hour.
//
// So a request carrying a valid API key is counted against that key instead,
// with the per-hour allowance stored on the key itself.
const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: (req) =>
    req.apiKey ? req.apiKey.rate_limit_per_hour : Number(process.env.RATE_LIMIT_APPLY || 15),
  // ipKeyGenerator normalises IPv6 to its /64 prefix; using req.ip raw would
  // let a client hop addresses inside its own subnet to reset the counter
  keyGenerator: (req) => (req.apiKey ? `key:${req.apiKey.id}` : ipKeyGenerator(req.ip)),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limited(
    'Too many applications submitted from this source. Please try again later.'
  ),
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
  handler: limited('Too many requests. Please slow down.'),
});

module.exports = {
  loginLimiter,
  applyLimiter,
  publicLimiter,
  passwordResetLimiter,
  passwordResetRedeemLimiter,
  totpLimiter,
};
