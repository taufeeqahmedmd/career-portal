const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const db = require('../db');
const totp = require('../utils/totp');
const { getSetting, getSettings, setSetting } = require('../utils/settings');
const { verifyCaptcha } = require('../utils/turnstile');
const { sendPasswordResetEmail } = require('../utils/mailer');
const {
  issueSessionToken,
  issueChallengeToken,
  predatesPasswordChange,
  CHALLENGE_MINUTES,
} = require('../utils/session');

// Clamped to a whole number of minutes: it is interpolated into the expiry
// interval below, where a parameter placeholder has no inferable type
const RESET_MINUTES = Math.min(
  Math.max(Math.trunc(Number(process.env.PASSWORD_RESET_MINUTES) || 15), 1),
  60
);
const RESET_MAX_ATTEMPTS = 5;
// A 6-digit code is only a million combinations, so guesses against one
// challenge are capped per account rather than only per IP
const TOTP_MAX_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 8;

// Every new account starts here and is forced to replace it at first sign-in.
// It is shared and well known, so it is only usable for a limited window:
// after this many days an administrator has to re-issue it. 0 = never expires.
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '12345678';
const INITIAL_PASSWORD_DAYS = Math.max(
  Math.trunc(Number(process.env.INITIAL_PASSWORD_DAYS ?? 7)),
  0
);

// A throwaway hash with the same cost as a real one. Comparing against it for
// unknown accounts keeps the response time of "no such user" indistinguishable
// from "wrong password" - otherwise the clock enumerates the user list.
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', 10);

// Postgres rejects NUL bytes in text parameters, which would otherwise surface
// as an unhandled 500 on unauthenticated endpoints
const cleanText = (value) =>
  typeof value === 'string' ? value.replace(/\0/g, '').trim() : '';

const USER_QUERY = `
  SELECT u.*, b.name AS branch_name,
         r.name AS role_name, r.permissions AS role_permissions, r.is_active AS role_is_active
  FROM users u
  LEFT JOIN branches b ON b.id = u.branch_id
  LEFT JOIN roles r ON r.id = u.role_id
`;

function parsePermissions(raw) {
  try {
    return JSON.parse(raw || '[]');
  } catch {
    return [];
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role_name: user.role_name,
    permissions: parsePermissions(user.role_permissions),
    school_group: user.school_group,
    branch_id: user.branch_id,
    branch_name: user.branch_name,
    must_change_password: !!user.must_change_password,
    totp_enabled: !!user.totp_enabled,
  };
}

// A user needs two-factor when their own switch is on, or when the super admin
// has turned it on for everyone
async function totpRequiredFor(user) {
  if (user.totp_enabled) return true;
  return (await getSetting('require_totp')) === '1';
}

// The shared initial password is only valid for a window after it was issued
function initialPasswordExpired(user) {
  if (!user.must_change_password || !INITIAL_PASSWORD_DAYS) return false;
  // password_changed_at is stamped when the temporary password is issued
  const issuedAt = user.password_changed_at
    ? new Date(user.password_changed_at)
    : new Date(user.created_at);
  const ageDays = (Date.now() - issuedAt.getTime()) / 86400000;
  return ageDays > INITIAL_PASSWORD_DAYS;
}

async function completeLogin(user, res) {
  await db.run('UPDATE users SET last_login_at = now() WHERE id = ?', user.id);
  res.json({
    token: issueSessionToken(user.id),
    user: publicUser(user),
    // The client sends the user straight to the change-password screen
    must_change_password: !!user.must_change_password,
  });
}

// Builds the enrolment payload: secret, QR code and the raw otpauth URI
async function buildEnrolment(user, secret) {
  const url = totp.otpauthUrl({
    secret,
    account: user.email,
    issuer: process.env.TOTP_ISSUER || 'Careers Portal',
  });
  let qr = null;
  try {
    qr = await QRCode.toDataURL(url, { margin: 1, width: 232 });
  } catch (err) {
    // A missing QR is recoverable - the secret can always be typed in by hand
    console.error('Could not render the 2FA QR code:', err.message);
  }
  return { secret, otpauth_url: url, qr_data_url: qr };
}

// ---- Sign in ---------------------------------------------------------------

exports.login = async (req, res) => {
  const body = req.body || {};
  // Non-string values must not reach trim()/bcrypt - they throw
  const email = cleanText(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const captcha = await verifyCaptcha(body.captcha_token, req.ip);
  if (!captcha.ok) {
    return res.status(400).json({ error: captcha.error, code: 'captcha_failed' });
  }

  const user = await db.get(`${USER_QUERY} WHERE LOWER(u.email) = LOWER(?)`, email);

  // Always spend the same work whether or not the account exists, so response
  // time cannot be used to enumerate valid addresses
  const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  // A deactivated account is reported the same way as a bad password: telling
  // the caller it exists confirms a valid credential pair
  if (!user || !passwordOk || !user.is_active) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.role_id && !user.role_is_active) {
    return res
      .status(401)
      .json({ error: 'Your role has been deactivated. Contact your administrator.' });
  }
  if (initialPasswordExpired(user)) {
    return res.status(401).json({
      error: 'This temporary password has expired. Ask an administrator to re-issue it.',
    });
  }

  if (await totpRequiredFor(user)) {
    // Enrolled already: ask for a code from the authenticator app. Passing the
    // password check again clears the guess counter, so a locked-out but
    // legitimate user recovers by signing in from the start.
    if (user.totp_secret && user.totp_confirmed_at) {
      await db.run('UPDATE users SET totp_attempts = 0 WHERE id = ?', user.id);
      return res.json({
        challenge: 'totp',
        challenge_token: issueChallengeToken(user.id, false),
        expires_in: CHALLENGE_MINUTES * 60,
      });
    }
    // First time: hand out a fresh secret and make them prove it works.
    // A secret is only trusted once confirmed, so an abandoned enrolment
    // leaves nothing usable behind.
    const secret = totp.generateSecret();
    await db.run(
      'UPDATE users SET totp_secret = ?, totp_confirmed_at = NULL, totp_attempts = 0 WHERE id = ?',
      secret,
      user.id
    );
    return res.json({
      challenge: 'totp_setup',
      challenge_token: issueChallengeToken(user.id, true),
      expires_in: CHALLENGE_MINUTES * 60,
      ...(await buildEnrolment(user, secret)),
    });
  }

  await completeLogin(user, res);
};

// Second leg of a two-factor sign-in: the challenge token plus a live code
exports.verifyTotp = async (req, res) => {
  const body = req.body || {};
  const challengeToken = typeof body.challenge_token === 'string' ? body.challenge_token : '';
  const code = String(body.code || '').replace(/\D/g, '');

  let payload;
  try {
    payload = jwt.verify(challengeToken, process.env.JWT_SECRET);
  } catch {
    return res
      .status(401)
      .json({ error: 'This sign-in attempt expired. Please enter your password again.' });
  }
  if (payload.stage !== 'totp') {
    return res.status(401).json({ error: 'Invalid sign-in request.' });
  }

  const user = await db.get(`${USER_QUERY} WHERE u.id = ?`, payload.id);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Account is inactive or no longer exists.' });
  }
  // A challenge is half of a completed password check, so it has to die with
  // that password. Otherwise a challenge minted with a stolen password still
  // redeems into a full session after the owner has reset it.
  if (user.password_changed_at && payload.iat != null) {
    const changedAt = Math.floor(new Date(user.password_changed_at).getTime() / 1000);
    if (payload.iat < changedAt) {
      return res
        .status(401)
        .json({ error: 'Your password changed. Please sign in again.' });
    }
  }
  if (!user.totp_secret) {
    return res
      .status(400)
      .json({ error: 'Two-factor setup is incomplete. Please sign in again.' });
  }

  // Guesses are capped per account, not only per IP, so a distributed attacker
  // who already has the password cannot brute-force the six digits
  if (Number(user.totp_attempts || 0) >= TOTP_MAX_ATTEMPTS) {
    return res.status(429).json({
      error: 'Too many incorrect codes. Please sign in again to start over.',
    });
  }

  const step = totp.verify(user.totp_secret, code);
  if (step === null) {
    const { rows } = await db.run(
      'UPDATE users SET totp_attempts = COALESCE(totp_attempts, 0) + 1 WHERE id = ? RETURNING totp_attempts',
      user.id
    );
    const left = TOTP_MAX_ATTEMPTS - Number(rows[0]?.totp_attempts || 0);
    return res.status(401).json({
      error:
        left > 0
          ? `That code is not valid. ${left} attempt(s) left.`
          : 'Too many incorrect codes. Please sign in again to start over.',
    });
  }
  // A code stays valid for its whole 30s window - remembering the last step
  // stops the same one being replayed by someone who saw it
  if (user.totp_last_step != null && Number(user.totp_last_step) >= step) {
    return res
      .status(401)
      .json({ error: 'That code has already been used. Wait for the next one.' });
  }

  // Only the enrolment is recorded here, not `totp_enabled`. A user challenged
  // because of the global switch keeps their personal switch off, so turning
  // the global one off again genuinely releases them - while their confirmed
  // secret survives, so turning it back on needs no re-enrolment.
  await db.run(
    `UPDATE users
     SET totp_last_step = ?, totp_confirmed_at = COALESCE(totp_confirmed_at, now()),
         totp_attempts = 0
     WHERE id = ?`,
    step,
    user.id
  );

  const fresh = await db.get(`${USER_QUERY} WHERE u.id = ?`, user.id);
  await completeLogin(fresh, res);
};

exports.me = (req, res) => {
  const {
    id,
    name,
    email,
    role_name,
    permissions,
    school_group,
    branch_id,
    branch_name,
    must_change_password,
    totp_enabled,
  } = req.user;
  res.json({
    user: {
      id,
      name,
      email,
      role_name,
      permissions,
      school_group,
      branch_id,
      branch_name,
      must_change_password: !!must_change_password,
      totp_enabled: !!totp_enabled,
    },
  });
};

// ---- Password change -------------------------------------------------------

// A handful of passwords are guessed first in every credential-stuffing run,
// and the shared initial password is public knowledge inside the organisation
const BANNED_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'qwerty123', 'admin123', 'welcome1', 'welcome123', 'letmein1', 'iloveyou',
  'abc12345', '11111111', '00000000', 'careers123', 'changeme',
]);

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return 'Password is too long (maximum 200 characters).';
  const normalised = password.toLowerCase();
  if (BANNED_PASSWORDS.has(normalised) || normalised === INITIAL_PASSWORD.toLowerCase()) {
    return 'That password is too common. Please choose a different one.';
  }
  // Not a complexity maze - just enough that it is not a single dictionary word
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

// Used for the forced first-login change and for voluntary changes afterwards
exports.changePassword = async (req, res) => {
  const body = req.body || {};
  const current = typeof body.current_password === 'string' ? body.current_password : '';
  const next = typeof body.new_password === 'string' ? body.new_password : '';

  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });

  const user = await db.get('SELECT id, password_hash FROM users WHERE id = ?', req.user.id);
  if (!user) return res.status(401).json({ error: 'Account no longer exists.' });

  if (!current || !bcrypt.compareSync(current, user.password_hash)) {
    return res.status(400).json({ error: 'Your current password is not correct.' });
  }
  // Otherwise a forced change could be satisfied by re-entering 12345678
  if (bcrypt.compareSync(next, user.password_hash)) {
    return res.status(400).json({ error: 'Choose a password you have not used before.' });
  }

  const updated = await db.run(
    `UPDATE users
     SET password_hash = ?, password_changed_at = now(), must_change_password = 0
     WHERE id = ?
     RETURNING password_changed_at`,
    bcrypt.hashSync(next, 10),
    user.id
  );

  // The stamp above invalidates the token this request arrived with, so the
  // caller needs a fresh one to stay signed in. It is stamped with the value the
  // database just wrote, so the two are compared on one clock rather than two.
  const changedAt = new Date(updated.rows[0].password_changed_at).getTime();
  const fresh = await db.get(`${USER_QUERY} WHERE u.id = ?`, user.id);
  res.json({
    success: true,
    token: issueSessionToken(user.id, changedAt),
    user: publicUser(fresh),
  });
};

// ---- Forgot password -------------------------------------------------------

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const sixDigitCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// Deliberately uniform: the response never reveals whether an address exists
const GENERIC_RESET_REPLY = {
  success: true,
  message: 'If that email is registered, a reset code is on its way.',
};

exports.forgotPassword = async (req, res) => {
  const body = req.body || {};
  const email = cleanText(body.email);
  if (!email) return res.status(400).json({ error: 'Enter your email address.' });

  const captcha = await verifyCaptcha(body.captcha_token, req.ip);
  if (!captcha.ok) {
    return res.status(400).json({ error: captcha.error, code: 'captcha_failed' });
  }

  const user = await db.get(
    'SELECT id, name, email, is_active FROM users WHERE LOWER(email) = LOWER(?)',
    email
  );

  // Reply immediately and identically for every address. Waiting on the SMTP
  // round trip would otherwise make a registered address obvious from the
  // response time alone, defeating the uniform message below.
  res.json(GENERIC_RESET_REPLY);

  if (!user || !user.is_active) return;

  try {
    // Only the newest code may be used
    await db.run(
      'UPDATE password_resets SET used_at = now() WHERE user_id = ? AND used_at IS NULL',
      user.id
    );

    const code = sixDigitCode();
    await db.run(
      `INSERT INTO password_resets (user_id, code_hash, expires_at)
       VALUES (?, ?, now() + INTERVAL '${RESET_MINUTES} minutes')`,
      user.id,
      hashCode(code)
    );

    const sent = await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      code,
      minutes: RESET_MINUTES,
    });
    if (!sent) {
      console.warn(`Password reset code for ${user.email} could not be emailed.`);
    }
  } catch (err) {
    // The response has already gone out; there is nothing to report to the
    // caller, but this must not take the process down
    console.error('Password reset dispatch failed for', user.email, '-', err.message);
  }
};

exports.resetPassword = async (req, res) => {
  const body = req.body || {};
  const email = cleanText(body.email);
  const code = String(body.code || '').replace(/\D/g, '');
  const next = typeof body.new_password === 'string' ? body.new_password : '';

  const captcha = await verifyCaptcha(body.captcha_token, req.ip);
  if (!captcha.ok) {
    return res.status(400).json({ error: captcha.error, code: 'captcha_failed' });
  }

  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  if (code.length !== 6) {
    return res.status(400).json({ error: 'Enter the 6-digit code from the email.' });
  }

  const invalid = { error: 'That code is not valid or has expired. Please request a new one.' };

  const user = await db.get(
    'SELECT id, password_hash, is_active FROM users WHERE LOWER(email) = LOWER(?)',
    email
  );
  if (!user || !user.is_active) return res.status(400).json(invalid);

  // Claim one attempt atomically before comparing. Reading the count and
  // incrementing it separately lets concurrent requests all see a stale value,
  // which turns a 5-guess cap into as many guesses as the attacker can send.
  const claim = await db.get(
    `UPDATE password_resets SET attempts = attempts + 1
     WHERE id = (
       SELECT id FROM password_resets
       WHERE user_id = ? AND used_at IS NULL AND expires_at > now()
       ORDER BY id DESC LIMIT 1
     )
     AND attempts < ${RESET_MAX_ATTEMPTS}
     RETURNING id, code_hash, attempts`,
    user.id
  );

  if (!claim) {
    // Either no live code, or its attempts are already spent - burn it so a
    // spent code cannot be probed further
    await db.run(
      `UPDATE password_resets SET used_at = now()
       WHERE user_id = ? AND used_at IS NULL AND attempts >= ${RESET_MAX_ATTEMPTS}`,
      user.id
    );
    return res.status(400).json(invalid);
  }

  // Constant-time compare so the hash cannot be probed byte by byte
  const expected = Buffer.from(claim.code_hash);
  const supplied = Buffer.from(hashCode(code));
  const matches =
    expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);

  if (!matches) {
    const left = RESET_MAX_ATTEMPTS - claim.attempts;
    return res.status(400).json({
      error: left > 0 ? `That code is not correct. ${left} attempt(s) left.` : invalid.error,
    });
  }

  // A reset that leaves the account on the shared initial password would
  // satisfy the forced-change gate without actually changing anything
  if (bcrypt.compareSync(next, user.password_hash)) {
    return res.status(400).json({ error: 'Choose a password you have not used before.' });
  }

  await db.run('UPDATE password_resets SET used_at = now() WHERE id = ?', claim.id);
  await db.run(
    `UPDATE users
     SET password_hash = ?, password_changed_at = now(), must_change_password = 0
     WHERE id = ?`,
    bcrypt.hashSync(next, 10),
    user.id
  );

  res.json({ success: true, message: 'Your password has been reset. You can sign in now.' });
};

// ---- Security settings (super admin) ---------------------------------------

exports.getSecuritySettings = async (req, res) => {
  const settings = await getSettings();
  res.json({
    require_totp: settings.require_totp === '1',
    captcha_configured: !!process.env.TURNSTILE_SECRET_KEY,
    initial_password: INITIAL_PASSWORD,
  });
};

exports.updateSecuritySettings = async (req, res) => {
  const body = req.body || {};
  if (body.require_totp !== undefined) {
    await setSetting('require_totp', body.require_totp ? '1' : '0', req.user.id);
  }
  const settings = await getSettings();
  res.json({ require_totp: settings.require_totp === '1' });
};

exports.INITIAL_PASSWORD = INITIAL_PASSWORD;
exports.MIN_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH;
