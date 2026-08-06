// The direct-API path other websites in the group integrate against:
// key authentication, entity locking, the field-level error contract and the
// sandbox dry run.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer,
  stopServer,
  request,
  submitApplication,
  psql,
  DB_NAME,
} = require('./helpers');
const { runOn } = require('./pgutil');
const { generateKey } = require('../utils/apiKeys');

test.before(startServer);
test.after(stopServer);

// utils/apiKeys writes through the server's own pool, which in this process
// points at the developer's database rather than the throwaway test one - so
// the row goes in directly, using the same key format the issuing script does
async function issueKey({ name, entity_code = null, rate_limit_per_hour = 120 }) {
  const { key, key_hash, key_prefix } = generateKey();
  await runOn(
    DB_NAME,
    `INSERT INTO api_keys (name, entity_code, key_prefix, key_hash, rate_limit_per_hour)
     VALUES ($1, $2, $3, $4, $5)`,
    [name, entity_code, key_prefix, key_hash, rate_limit_per_hour]
  );
  return key;
}

// The sample data seeds vacancies for Pallavi only; DPS exists as an entity
// with none, which makes it the natural "other business" for the scope tests
const HIRING_ENTITY = 'Pallavi';
const OTHER_ENTITY = 'DPS';

const openingFor = async (entity) => {
  const res = await request(`/openings?entity=${encodeURIComponent(entity)}`);
  return res.body.openings[0];
};

test('openings can be filtered to one business', async () => {
  const all = await request('/openings');
  const mine = await request(`/openings?entity=${HIRING_ENTITY}`);

  assert.ok(mine.body.openings.length > 0, 'the seeded entity should have openings');
  assert.ok(
    mine.body.openings.every((o) => o.school_group === HIRING_ENTITY),
    'every opening returned must belong to the requested entity'
  );
  assert.equal(all.body.openings.length, mine.body.openings.length + 0);

  // Codes are matched case-insensitively
  const lower = await request(`/openings?entity=${HIRING_ENTITY.toLowerCase()}`);
  assert.equal(lower.body.openings.length, mine.body.openings.length);

  // A business with no vacancies is an empty list, not an error
  const empty = await request(`/openings?entity=${OTHER_ENTITY}`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.openings, []);

  // ...and so is a code that does not exist at all
  const unknown = await request('/openings?entity=NoSuchBusiness');
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body.openings, []);

  // A branch filter narrows it further
  const branch = mine.body.openings[0].branch;
  const byBranch = await request(
    `/openings?entity=${HIRING_ENTITY}&branch=${encodeURIComponent(branch)}`
  );
  assert.ok(byBranch.body.openings.length > 0);
  assert.ok(byBranch.body.openings.every((o) => o.branch === branch));
});

test('an unrecognised API key is rejected outright', async () => {
  const opening = await openingFor(HIRING_ENTITY);
  const res = await submitApplication({
    name: 'Bad Key',
    mobile: '9800000001',
    openingId: opening.id,
    apiKey: 'ck_live_deadbeef',
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.errors[0].code, 'unauthorized');
  assert.equal(res.body.errors[0].field, 'api_key');
});

test('a keyed submission is accepted and stamped with the sending site', async () => {
  const key = await issueKey({ name: 'Acme careers site', entity_code: HIRING_ENTITY });
  const opening = await openingFor(HIRING_ENTITY);

  const res = await submitApplication({
    name: 'Keyed Applicant',
    mobile: '9800000002',
    openingId: opening.id,
    apiKey: key,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  const via = await psql(
    `SELECT submitted_via FROM applications WHERE mobile = '9800000002'`
  );
  assert.equal(via, 'Acme careers site');

  // With no campaign tags of its own, the submission is labelled with the site
  const source = await psql(`SELECT source FROM applications WHERE mobile = '9800000002'`);
  assert.equal(source, 'Acme careers site');
});

test('a key cannot file applications for another business', async () => {
  const key = await issueKey({ name: 'Other business site', entity_code: OTHER_ENTITY });
  const otherOpening = await openingFor(HIRING_ENTITY);

  const res = await submitApplication({
    name: 'Cross Entity',
    mobile: '9800000003',
    openingId: otherOpening.id,
    apiKey: key,
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.errors[0].code, 'forbidden');
  assert.equal(res.body.errors[0].field, 'opening_id');

  const count = await psql(
    `SELECT COUNT(*) FROM applications WHERE mobile = '9800000003'`
  );
  assert.equal(count, '0', 'nothing may be written for a rejected key');
});

test('a revoked key stops working', async () => {
  const key = await issueKey({ name: 'Temporary site', entity_code: HIRING_ENTITY });
  await runOn(DB_NAME, `UPDATE api_keys SET is_active = 0, revoked_at = now() WHERE name = 'Temporary site'`);

  const opening = await openingFor(HIRING_ENTITY);
  const res = await submitApplication({
    name: 'After Revoke',
    mobile: '9800000004',
    openingId: opening.id,
    apiKey: key,
  });
  assert.equal(res.status, 401);
});

test('every validation failure is reported at once, per field', async () => {
  const res = await request('/applications', {
    method: 'POST',
    body: (() => {
      const form = new FormData();
      form.append('full_name', 'Ab'); // too short
      form.append('email', 'not-an-email'); // invalid
      form.append('mobile', '123'); // wrong length
      form.append('opening_id', '0'); // invalid
      form.append('experience_years', '99'); // out of range
      // current_company and resume missing entirely
      return form;
    })(),
  });

  assert.equal(res.status, 400);
  const byField = Object.fromEntries(res.body.errors.map((e) => [e.field, e.code]));

  assert.equal(byField.full_name, 'too_short');
  assert.equal(byField.email, 'invalid');
  assert.equal(byField.mobile, 'invalid');
  assert.equal(byField.opening_id, 'invalid');
  assert.equal(byField.experience_years, 'out_of_range');
  assert.equal(byField.current_company, 'required');
  assert.equal(byField.resume, 'required');

  // One failure per field, never two for the same input
  const fields = res.body.errors.map((e) => e.field);
  assert.equal(new Set(fields).size, fields.length);

  // The old single-message shape still travels alongside it
  assert.equal(typeof res.body.error, 'string');
  assert.equal(res.body.error, res.body.errors[0].message);
});

test('a sandbox submission validates but writes nothing', async () => {
  const key = await issueKey({ name: 'Sandbox site', entity_code: HIRING_ENTITY });
  const opening = await openingFor(HIRING_ENTITY);

  const ok = await submitApplication({
    name: 'Dry Run',
    mobile: '9800000005',
    openingId: opening.id,
    apiKey: key,
    fields: { sandbox: 'true' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.sandbox, true);
  assert.equal(ok.body.would_create.position, opening.position);

  const count = await psql(`SELECT COUNT(*) FROM applications WHERE mobile = '9800000005'`);
  assert.equal(count, '0', 'a dry run must not create an applicant');

  // Repeatable: the duplicate rule is not burned by testing
  const again = await submitApplication({
    name: 'Dry Run',
    mobile: '9800000005',
    openingId: opening.id,
    apiKey: key,
    fields: { sandbox: 'true' },
  });
  assert.equal(again.status, 200);

  // ...and it reports the same failures a real submission would
  const bad = await submitApplication({
    name: 'X',
    mobile: '9800000006',
    openingId: opening.id,
    apiKey: key,
    fields: { sandbox: 'true' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.errors[0].field, 'full_name');

  // The real submission still works afterwards
  const real = await submitApplication({
    name: 'Dry Run',
    mobile: '9800000005',
    openingId: opening.id,
    apiKey: key,
  });
  assert.equal(real.status, 200);
});

test('the portal keeps working with no key at all', async () => {
  const opening = await openingFor(HIRING_ENTITY);
  const res = await submitApplication({
    name: 'Anonymous Applicant',
    mobile: '9800000007',
    openingId: opening.id,
  });
  assert.equal(res.status, 200);

  const via = await psql(`SELECT submitted_via FROM applications WHERE mobile = '9800000007'`);
  assert.equal(via, '', 'the portal itself is not a partner site');
});

test('per-key rate limits are counted separately from the IP', async () => {
  const key = await issueKey({
    name: 'Tiny budget site',
    entity_code: HIRING_ENTITY,
    rate_limit_per_hour: 2,
  });
  const opening = await openingFor(HIRING_ENTITY);

  const results = [];
  for (let i = 0; i < 3; i++) {
    results.push(
      await submitApplication({
        name: `Budget ${i}`,
        mobile: `98100000${10 + i}`,
        openingId: opening.id,
        apiKey: key,
      })
    );
  }

  assert.equal(results[0].status, 200);
  assert.equal(results[1].status, 200);
  assert.equal(results[2].status, 429, 'the third exceeds this key\'s hourly allowance');
  assert.equal(results[2].body.errors[0].code, 'rate_limited');

  // The anonymous path has its own budget and is unaffected by the exhausted key
  const anonymous = await submitApplication({
    name: 'Unaffected',
    mobile: '9810000020',
    openingId: opening.id,
  });
  assert.equal(anonymous.status, 200);
});
