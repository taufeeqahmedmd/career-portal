#!/usr/bin/env node
//
// Issue, list and revoke the API keys used by the other websites in the group.
//
//   node scripts/api-key.js list
//   node scripts/api-key.js create --name "Acme Logistics site" --entity Acme [--limit 120]
//   node scripts/api-key.js revoke --id 3
//
// The plaintext key is printed once, at creation, and is not recoverable
// afterwards - only its digest is stored. If it is lost, revoke it and issue
// another.

require('dotenv').config();
const db = require('../db');
const { createKey } = require('../utils/apiKeys');

const args = process.argv.slice(2);
const command = args[0];

const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const usage = () => {
  console.log(`
Usage:
  node scripts/api-key.js list
  node scripts/api-key.js create --name "<site name>" [--entity <CODE>] [--limit <per hour>]
  node scripts/api-key.js revoke --id <id>

  --name    Shown in the admin and written onto every application the key files
  --entity  Entity code the key is locked to. Omit to allow every entity.
  --limit   Applications per hour for this key (default 120)
`);
};

async function list() {
  const keys = await db.all(
    `SELECT id, name, entity_code, key_prefix, rate_limit_per_hour, is_active,
            last_used_at, revoked_at, created_at
       FROM api_keys ORDER BY id`
  );
  if (!keys.length) return console.log('No API keys have been issued yet.');

  console.log('');
  for (const k of keys) {
    const state = k.revoked_at ? 'REVOKED' : k.is_active ? 'active' : 'disabled';
    const used = k.last_used_at ? new Date(k.last_used_at).toISOString() : 'never used';
    console.log(
      `  #${k.id}  ${k.name}\n` +
        `      key      ${k.key_prefix}…\n` +
        `      entity   ${k.entity_code || '(all entities)'}\n` +
        `      limit    ${k.rate_limit_per_hour}/hour\n` +
        `      state    ${state}, ${used}\n`
    );
  }
}

async function create() {
  const name = flag('name');
  const entity = flag('entity') || null;
  const limit = Number(flag('limit') || 120);

  if (!name) {
    console.error('--name is required.');
    return usage();
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return console.error('--limit must be a positive whole number.');
  }
  // A typo in the entity code would silently produce a key that can never post
  // anywhere, so it is checked against the table rather than trusted
  if (entity) {
    const found = await db.get('SELECT code, is_active FROM entities WHERE LOWER(code) = LOWER(?)', entity);
    if (!found) {
      const all = await db.all('SELECT code FROM entities ORDER BY code');
      return console.error(
        `No entity with code "${entity}". Existing codes: ${all.map((e) => e.code).join(', ') || '(none)'}`
      );
    }
    if (!found.is_active) console.warn(`Warning: entity "${found.code}" is not active.`);
  }

  const created = await createKey({
    name,
    // Store the code exactly as the entities table spells it
    entity_code: entity
      ? (await db.get('SELECT code FROM entities WHERE LOWER(code) = LOWER(?)', entity)).code
      : null,
    rate_limit_per_hour: limit,
  });

  console.log(`
  API key created

    id       ${created.id}
    name     ${created.name}
    entity   ${created.entity_code || '(all entities)'}
    limit    ${created.rate_limit_per_hour}/hour

    key      ${created.key}

  Copy it now - it is stored only as a hash and cannot be shown again.
  Send it to the site owner over a channel you would send a password over.
`);
}

async function revoke() {
  const id = Number(flag('id'));
  if (!Number.isInteger(id) || id <= 0) return console.error('--id must be a key id from `list`.');

  const result = await db.run(
    `UPDATE api_keys SET is_active = 0, revoked_at = now()
      WHERE id = ? AND revoked_at IS NULL
      RETURNING name`,
    id
  );
  if (!result.changes) return console.error(`No active key with id ${id}.`);
  console.log(`Revoked key #${id} (${result.rows[0].name}). Its next request will be rejected.`);
}

(async () => {
  try {
    if (command === 'list') await list();
    else if (command === 'create') await create();
    else if (command === 'revoke') await revoke();
    else usage();
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
