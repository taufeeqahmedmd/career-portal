// Configuration problems that only show up in production, and only once a real
// person is locked out or a form silently stops working. Reported at boot
// instead, loudly, while someone is still watching the logs.
const db = require('../db');

const isProduction = () => process.env.NODE_ENV === 'production';

// Addresses that will never receive mail. A super admin on one of these cannot
// reset their password and cannot approve a CSV export.
const UNDELIVERABLE = /\.(local|localhost|invalid|test|example)$|@(example|test)\./i;

async function runStartupChecks() {
  const problems = [];
  const notes = [];

  if (!process.env.TRUST_PROXY) {
    notes.push(
      'TRUST_PROXY is not set. If this runs behind Nginx or Cloudflare, every visitor ' +
        'shares one rate-limit bucket: a few failed logins lock out all admins and the ' +
        'application form stops accepting submissions site-wide.'
    );
  }
  if (!process.env.TURNSTILE_SECRET_KEY) {
    notes.push(
      'TURNSTILE_SECRET_KEY is not set, so the public application form has no captcha.'
    );
  }
  if (!process.env.ALLOWED_ORIGINS) {
    notes.push('ALLOWED_ORIGINS is not set, so the API accepts requests from any origin.');
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    problems.push(
      'SMTP is not configured. Password resets and CSV export approval codes cannot be sent.'
    );
  }

  try {
    const supers = await db.all(
      `SELECT u.email FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = 1 AND (u.role = 'super_admin' OR r.permissions LIKE '%"*"%')`
    );
    if (!supers.length) {
      problems.push('There is no active super admin. Nobody can administer this instance.');
    } else {
      const unreachable = supers.map((s) => s.email).filter((e) => UNDELIVERABLE.test(e));
      if (unreachable.length === supers.length) {
        problems.push(
          `No super admin has a deliverable email address (${unreachable.join(', ')}). ` +
            'Password resets and export approval codes have nowhere to go. Change it from ' +
            'the Users page.'
        );
      } else if (unreachable.length) {
        notes.push(`Super admin(s) with an undeliverable address: ${unreachable.join(', ')}`);
      }
    }
  } catch {
    // The database check is best effort - a failure here is reported elsewhere
  }

  if (problems.length || notes.length) {
    console.warn('');
    console.warn('--- Configuration review -------------------------------------');
    problems.forEach((p) => console.warn(`  [needs attention] ${p}`));
    notes.forEach((n) => console.warn(`  [note] ${n}`));
    console.warn('---------------------------------------------------------------');
    console.warn('');
  }

  // Never fatal: a running portal with a warning beats one that refuses to boot
  return { problems, notes, production: isProduction() };
}

module.exports = { runStartupChecks };
