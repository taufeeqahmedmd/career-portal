// The read-only data feed for reporting tools: who may read it, what each
// dataset holds, that an entity key only sees its own slice, and that the two
// kinds of API key never stand in for each other.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer,
  stopServer,
  request,
  rootToken,
  submitApplication,
  psql,
  DB_NAME,
} = require('./helpers');
const { runOn } = require('./pgutil');
const { generateKey } = require('../utils/apiKeys');

// Fixtures are built in the same hook that boots the server: separate root
// `before` hooks are not awaited one after another, so a second one would race
// the server's startup.
//
// A batch of two makes every dataset span several cursor fetches, so the seams
// between batches (JSON commas, a single CSV header) are exercised.
test.before(async () => {
  await startServer({ EXPORT_BATCH_SIZE: '2' });
  await buildFixtures();
});
test.after(stopServer);

// Written straight into the test database, in the issuing script's format - see
// the note on issueKey in api-keys.test.js
async function issueKey({ name, kind = 'reporting', entity_code = null, rate_limit_per_hour = 120 }) {
  const { key, key_hash, key_prefix } = generateKey();
  await runOn(
    DB_NAME,
    `INSERT INTO api_keys (name, kind, entity_code, key_prefix, key_hash, rate_limit_per_hour)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [name, kind, entity_code, key_prefix, key_hash, rate_limit_per_hour]
  );
  return key;
}

const feed = (path, key) =>
  request(`/data${path}`, { headers: key ? { 'X-API-Key': key } : undefined });

const feedCsv = async (path, key) => {
  const res = await request(`/data${path}`, { headers: { 'X-API-Key': key }, raw: true });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

// The sample data seeds vacancies for Pallavi only; DPS has none of its own
const HIRING_ENTITY = 'Pallavi';
const OTHER_ENTITY = 'DPS';

let candidate; // one application taken through screening and a round
let handedOver; // one Pallavi application handed to a DPS branch

async function buildFixtures() {
  const root = await rootToken();
  const openings = (await request(`/openings?entity=${HIRING_ENTITY}`)).body.openings;

  await submitApplication({ name: 'Feed Candidate', mobile: '9600000001', openingId: openings[0].id });
  await submitApplication({ name: 'Feed Handover', mobile: '9600000002', openingId: openings[1].id });
  await submitApplication({ name: 'Feed Untouched', mobile: '9600000003', openingId: openings[0].id });

  const find = async (name) =>
    (await request(`/admin/applications?search=${encodeURIComponent(name)}`, { token: root })).body
      .applications[0];
  candidate = await find('Feed Candidate');
  handedOver = await find('Feed Handover');

  await request(`/admin/applications/${candidate.id}/screening`, {
    method: 'PUT',
    token: root,
    body: {
      status: 'shortlisted',
      expected_salary: '8 LPA',
      relocate: true,
      next_round: true,
      next_assigned_name: 'Panel A',
    },
  });
  await request(`/admin/applications/${candidate.id}/rounds/1`, {
    method: 'PUT',
    token: root,
    body: { feedback: 'strong demo lesson', status: 'shortlisted', next_round: false },
  });

  // A DPS branch to hand the second applicant over to
  const branch = await request('/admin/branches', {
    method: 'POST',
    token: root,
    body: { name: 'Feed Receiving Branch', school_group: OTHER_ENTITY },
  });
  assert.equal(branch.status, 201, branch.body?.error);
  const referred = await request(`/admin/applications/${handedOver.id}/screening`, {
    method: 'PUT',
    token: root,
    body: { referred_entity: OTHER_ENTITY, referred_branch: 'Feed Receiving Branch' },
  });
  assert.equal(referred.status, 200, referred.body?.error);
}

test('the feed is closed without a reporting key', async () => {
  const none = await feed('/applications');
  assert.equal(none.status, 401);
  assert.equal(none.body.errors[0].field, 'api_key');

  const wrong = await feed('/applications', 'ck_live_deadbeef');
  assert.equal(wrong.status, 401);

  // A partner site's key files applications; it must not read candidates
  const submitKey = await issueKey({ name: 'Partner site', kind: 'submit' });
  const partner = await feed('/applications', submitKey);
  assert.equal(partner.status, 403);
  assert.equal(partner.body.errors[0].code, 'forbidden');

  const revokedKey = await issueKey({ name: 'Old dashboard' });
  await runOn(DB_NAME, `UPDATE api_keys SET is_active = 0, revoked_at = now() WHERE name = 'Old dashboard'`);
  assert.equal((await feed('/applications', revokedKey)).status, 401);
});

test('the feed is read-only: every write method is refused', async () => {
  const key = await issueKey({ name: 'Would-be writer' });
  const before = await psql('SELECT COUNT(*) FROM applications');

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['', '/applications', `/applications/${candidate.id}`]) {
      const res = await request(`/data${path}`, {
        method,
        headers: { 'X-API-Key': key },
        body: { full_name: 'Overwritten' },
      });
      assert.equal(res.status, 405, `${method} /data${path}`);
      assert.equal(res.body.errors[0].code, 'method_not_allowed');
      assert.equal(res.headers.get('allow'), 'GET, HEAD');
    }
  }

  assert.equal(await psql('SELECT COUNT(*) FROM applications'), before);
  assert.equal(
    await psql(`SELECT full_name FROM applications WHERE id = ${candidate.id}`),
    'Feed Candidate'
  );
});

test('a reporting key cannot submit applications', async () => {
  const key = await issueKey({ name: 'Read only BI' });
  const opening = (await request(`/openings?entity=${HIRING_ENTITY}`)).body.openings[0];

  const res = await submitApplication({
    name: 'Through Reporting Key',
    mobile: '9600000009',
    openingId: opening.id,
    apiKey: key,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.errors[0].field, 'api_key');

  const count = await psql(`SELECT COUNT(*) FROM applications WHERE mobile = '9600000009'`);
  assert.equal(count, '0', 'nothing may be written through a reporting key');
});

test('applications carry the pipeline as the admin panel shows it', async () => {
  const key = await issueKey({ name: 'Power BI' });
  const res = await feed('/applications', key);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.headers.get('cache-control'), 'private, no-store');

  const total = Number(await psql('SELECT COUNT(*) FROM applications'));
  assert.equal(res.body.length, total, 'an unscoped key sees every application');

  const row = res.body.find((a) => a.id === candidate.id);
  assert.equal(row.full_name, 'Feed Candidate');
  assert.equal(row.entity, HIRING_ENTITY);
  assert.equal(row.stage_key, 'in_interview', 'saving a round advances a shortlisted candidate');
  assert.equal(row.stage, 'In Interview', 'the stage carries its configured label');
  assert.equal(row.screening_expected_salary, '8 LPA');
  assert.equal(row.willing_to_relocate, true);
  assert.equal(row.interview_rounds, 1);
  assert.equal(row.reached_interview, true);
  assert.equal(row.latest_round_assignee, 'Panel A');
  assert.equal(row.source, 'Website');
  assert.equal(row.submitted_via, 'Careers portal');
  assert.match(row.submitted_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(row.submitted_at)));

  const untouched = res.body.find((a) => a.full_name === 'Feed Untouched');
  assert.equal(untouched.stage_key, 'new');
  assert.equal(untouched.interview_rounds, 0);
  assert.equal(untouched.reached_interview, false);
});

test('rounds and activity are their own tables, joined by application_id', async () => {
  const key = await issueKey({ name: 'Rounds reader' });

  const rounds = (await feed('/interview_rounds', key)).body;
  const round = rounds.find((r) => r.application_id === candidate.id);
  assert.equal(round.round_no, 1);
  assert.equal(round.feedback, 'strong demo lesson');
  assert.equal(round.assigned_to, 'Panel A');
  assert.equal(round.took_place, true);
  assert.equal(round.updated_by, 'Super Admin');

  const activity = (await feed('/activity', key)).body;
  const mine = activity.filter((a) => a.application_id === candidate.id);
  const submitted = mine.find((a) => a.action === 'submitted');
  assert.ok(submitted, 'the submission is on the timeline');
  assert.equal(submitted.actor, null, 'the applicant is not a staff member');
  assert.ok(mine.some((a) => a.action === 'screening' && a.actor === 'Super Admin'));
});

test('reference datasets are present and staff credentials are not', async () => {
  const key = await issueKey({ name: 'Reference reader' });

  const entities = (await feed('/entities', key)).body;
  assert.deepEqual(entities.map((e) => e.code).sort(), [OTHER_ENTITY, HIRING_ENTITY].sort());

  const openings = (await feed('/openings', key)).body;
  assert.ok(openings.length > 0);
  const withApplicants = openings.find((o) => o.applications > 0);
  assert.ok(withApplicants, 'openings carry their application count');

  const branches = (await feed('/branches', key)).body;
  assert.ok(branches.some((b) => b.name === 'Feed Receiving Branch'));

  const stages = (await feed('/flow_options', key)).body.filter((o) => o.type === 'profile_stage');
  assert.ok(stages.some((s) => s.key === 'new'));

  const users = (await feed('/users', key)).body;
  const root = users.find((u) => u.name === 'Super Admin');
  assert.ok(root);
  for (const secret of ['password_hash', 'totp_secret', 'totp_enabled', 'must_change_password']) {
    assert.ok(!(secret in root), `${secret} must not leave the server`);
  }
});

test('an entity key sees its own slice, including leads handed to it', async () => {
  const dps = await issueKey({ name: 'DPS dashboard', entity_code: OTHER_ENTITY });

  const applications = (await feed('/applications', dps)).body;
  assert.deepEqual(
    applications.map((a) => a.id),
    [handedOver.id],
    'only the lead handed to a DPS branch, as a DPS admin would see it'
  );

  // Its rounds and activity follow the same applications
  const activity = (await feed('/activity', dps)).body;
  assert.ok(activity.length > 0);
  assert.ok(activity.every((a) => a.application_id === handedOver.id));

  const entities = (await feed('/entities', dps)).body;
  assert.deepEqual(entities.map((e) => e.code), [OTHER_ENTITY]);
  assert.ok((await feed('/branches', dps)).body.every((b) => b.entity === OTHER_ENTITY));
  assert.deepEqual((await feed('/openings', dps)).body, [], 'DPS has no vacancies of its own');
  assert.ok(
    !(await feed('/users', dps)).body.some((u) => u.name === 'Super Admin'),
    'an unrestricted account is not part of one entity'
  );

  // The other entity's key sees everything submitted to it, but not DPS
  const pallavi = await issueKey({ name: 'Pallavi dashboard', entity_code: HIRING_ENTITY });
  const theirs = (await feed('/applications', pallavi)).body;
  assert.ok(theirs.length >= 3);
  assert.ok(theirs.every((a) => a.entity === HIRING_ENTITY));
});

test('one call returns every dataset from one snapshot', async () => {
  const key = await issueKey({ name: 'Everything at once' });
  const res = await feed('', key);
  assert.equal(res.status, 200);

  const body = res.body;
  assert.ok(!Number.isNaN(Date.parse(body.generated_at)));
  assert.equal(body.timezone, 'Asia/Kolkata');
  assert.equal(body.entity, null);
  for (const name of body.datasets) {
    assert.ok(Array.isArray(body[name]), `${name} should be an array`);
  }
  assert.deepEqual(body.datasets, [
    'applications',
    'interview_rounds',
    'activity',
    'openings',
    'branches',
    'entities',
    'users',
    'flow_options',
  ]);

  // The tables agree with each other: nothing points at a missing application
  const ids = new Set(body.applications.map((a) => a.id));
  assert.ok(body.interview_rounds.every((r) => ids.has(r.application_id)));
  assert.ok(body.activity.every((a) => ids.has(a.application_id)));

  // ...and with the single-dataset endpoint
  const single = (await feed('/applications', key)).body;
  assert.deepEqual(body.applications, single);

  // CSV is one table per file
  const csv = await feed('?format=csv', key);
  assert.equal(csv.status, 400);
  assert.equal(csv.body.errors[0].field, 'format');
});

test('CSV has the same columns as JSON', async () => {
  const key = await issueKey({ name: 'Excel' });
  const json = (await feed('/applications', key)).body;
  const csv = await feedCsv('/applications?format=csv', key);

  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /filename="applications-\d{4}-\d{2}-\d{2}\.csv"/);

  // fetch's text() strips the BOM, so it is checked as bytes
  const raw = await request('/data/entities?format=csv', { headers: { 'X-API-Key': key }, raw: true });
  const bytes = Buffer.from(await raw.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');

  const lines = csv.text.split('\r\n').filter(Boolean);
  assert.deepEqual(lines[0].split(','), Object.keys(json[0]));
  assert.equal(lines.length - 1, json.length, 'one line per row, plus the header');

  // An empty table still has its header, so a report can bind to its columns
  const dps = await issueKey({ name: 'Empty CSV', entity_code: OTHER_ENTITY });
  const empty = await feedCsv('/openings?format=csv', dps);
  assert.equal(empty.status, 200);
  assert.ok(empty.text.startsWith('id,position,branch,entity'));
  assert.equal(empty.text.split('\r\n').filter(Boolean).length, 1);
});

test('a date window selects applications by submission day', async () => {
  const key = await issueKey({ name: 'Windowed' });

  const future = await feed('/applications?from=2999-01-01', key);
  assert.equal(future.status, 200);
  assert.deepEqual(future.body, []);
  // Rounds and activity follow their application out of the window
  assert.deepEqual((await feed('/interview_rounds?from=2999-01-01', key)).body, []);
  assert.deepEqual((await feed('/activity?from=2999-01-01', key)).body, []);

  const past = await feed('/applications?to=2000-01-01', key);
  assert.deepEqual(past.body, []);

  const all = (await feed('/applications?from=2000-01-01&to=2999-12-31', key)).body;
  assert.equal(all.length, Number(await psql('SELECT COUNT(*) FROM applications')));

  // A bad date is an error, never a silent "everything"
  const bad = await feed('/applications?from=03-10-2026', key);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.errors[0].field, 'from');
});

test('an unknown dataset is a 404 that lists the real ones', async () => {
  const key = await issueKey({ name: 'Typo' });
  const res = await feed('/candidates', key);
  assert.equal(res.status, 404);
  assert.equal(res.body.errors[0].code, 'not_found');
  assert.match(res.body.error, /applications, interview_rounds/);

  // Not a property lookup on the dataset table
  assert.equal((await feed('/constructor', key)).status, 404);
});

test('a reporting key has its own hourly allowance', async () => {
  const key = await issueKey({ name: 'Tiny allowance', rate_limit_per_hour: 2 });
  assert.equal((await feed('/entities', key)).status, 200);
  assert.equal((await feed('/entities', key)).status, 200);
  const third = await feed('/entities', key);
  assert.equal(third.status, 429);
  assert.equal(third.body.errors[0].code, 'rate_limited');

  // Another key is unaffected
  const other = await issueKey({ name: 'Unaffected allowance' });
  assert.equal((await feed('/entities', other)).status, 200);
});
