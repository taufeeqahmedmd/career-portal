// API keys for the other websites in the group that post applications straight
// to the public API.
//
// A key is 32 random bytes, rendered as `ck_live_<64 hex>`. Only its SHA-256
// digest is stored, so the plaintext exists exactly once - in the output of the
// issuing script - and cannot be recovered from a database dump.
//
// SHA-256 rather than bcrypt on purpose: this runs on every partner request,
// and the input is 256 bits of entropy rather than a human-chosen password, so
// there is nothing for a slow hash to protect against.

const crypto = require('crypto');
const db = require('../db');

const PREFIX = 'ck_live_';
// Enough to identify a key in a log line, far too little to reconstruct it
const DISPLAY_PREFIX_LENGTH = PREFIX.length + 8;

const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

// Returns the plaintext key; the caller is responsible for showing it once
function generateKey() {
  const key = PREFIX + crypto.randomBytes(32).toString('hex');
  return {
    key,
    key_hash: hashKey(key),
    key_prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

// Constant-time compare is unnecessary here: the lookup is by digest, so no
// comparison of secrets happens in this process at all.
async function findByKey(key) {
  const value = String(key || '');
  if (!value.startsWith(PREFIX)) return null;
  const row = await db.get(
    `SELECT k.*, e.is_active AS entity_active
       FROM api_keys k
       LEFT JOIN entities e ON e.code = k.entity_code
      WHERE k.key_hash = ?`,
    hashKey(value)
  );
  return row || null;
}

// `last_used_at` is for the humans reading the key list, not for anything the
// application decides on - so it is written at most once every few minutes
// rather than on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

async function touch(keyRow) {
  const last = keyRow.last_used_at ? new Date(keyRow.last_used_at).getTime() : 0;
  if (Date.now() - last < TOUCH_INTERVAL_MS) return;
  try {
    await db.run('UPDATE api_keys SET last_used_at = now() WHERE id = ?', keyRow.id);
  } catch (err) {
    // Bookkeeping must never fail a submission
    console.warn('Could not update api_keys.last_used_at:', err.message);
  }
}

async function createKey({ name, entity_code = null, rate_limit_per_hour = 120 }) {
  const { key, key_hash, key_prefix } = generateKey();
  const result = await db.run(
    `INSERT INTO api_keys (name, entity_code, key_prefix, key_hash, rate_limit_per_hour)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, name, entity_code, key_prefix, rate_limit_per_hour, created_at`,
    name,
    entity_code,
    key_prefix,
    key_hash,
    rate_limit_per_hour
  );
  return { ...result.rows[0], key };
}

module.exports = { PREFIX, generateKey, hashKey, findByKey, touch, createKey };
