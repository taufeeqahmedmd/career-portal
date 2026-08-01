// Global switches a super admin flips from the portal, stored in app_settings.
const db = require('../db');

const DEFAULTS = {
  // Force every account onto two-factor authentication, on top of the
  // per-user switches on the Users page
  require_totp: '0',
};

async function getSetting(key) {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', key);
  return row ? row.value : DEFAULTS[key] ?? '';
}

async function getSettings() {
  const rows = await db.all('SELECT key, value FROM app_settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored };
}

async function setSetting(key, value, actorId = null) {
  await db.run(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    key,
    String(value),
    actorId
  );
}

module.exports = { getSetting, getSettings, setSetting, DEFAULTS };
