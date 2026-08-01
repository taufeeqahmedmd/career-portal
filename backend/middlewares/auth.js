const jwt = require('jsonwebtoken');
const db = require('../db');
const { can } = require('../utils/permissions');
const { predatesPasswordChange } = require('../utils/session');

const JWT_SECRET = process.env.JWT_SECRET;

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  // Only a completed sign-in opens the portal. Anything else - a half-finished
  // two-factor challenge, or any token type added later - is refused by
  // default rather than allowed by default.
  if (payload.stage !== 'session') {
    return res.status(401).json({ error: 'Please complete sign-in first.' });
  }

  let user;
  try {
    user = await db.get(
      `SELECT u.id, u.email, u.name, u.school_group, u.branch_id, u.role_id, u.is_active,
              u.password_changed_at, u.must_change_password, u.totp_enabled,
              b.name AS branch_name, b.school_group AS branch_group,
              r.name AS role_name, r.permissions AS role_permissions,
              r.is_active AS role_is_active
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`,
      payload.id
    );
  } catch (err) {
    return next(err);
  }
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Account is inactive or no longer exists.' });
  }
  // Deactivating a role is presented in the UI as a revocation, so it has to
  // actually revoke: holders lose access until the role is switched back on
  if (user.role_id && !user.role_is_active) {
    return res
      .status(401)
      .json({ error: 'Your role has been deactivated. Contact your administrator.' });
  }
  delete user.role_is_active;

  // A password change invalidates every token issued before it
  if (predatesPasswordChange(payload, user.password_changed_at)) {
    return res
      .status(401)
      .json({ error: 'Your password was changed. Please log in again.' });
  }
  delete user.password_changed_at;

  try {
    user.permissions = JSON.parse(user.role_permissions || '[]');
  } catch {
    user.permissions = [];
  }
  delete user.role_permissions;

  req.user = user;
  next();
}

// Route guard factory: requirePermission('openings.manage')
function requirePermission(permission) {
  return (req, res, next) => {
    if (!can(req.user, permission)) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    next();
  };
}

// Everything registered after this is closed to an account that is still on its
// initial password. Mounted below /me and /change-password so the user can see
// who they are and set a new password, and nothing else.
function requirePasswordChanged(req, res, next) {
  if (req.user?.must_change_password) {
    return res.status(403).json({
      error: 'Please set a new password before using the portal.',
      code: 'password_change_required',
    });
  }
  next();
}

module.exports = { requireAuth, requirePermission, requirePasswordChanged };
