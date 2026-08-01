// The seed runs on every boot, so anything it writes runs again on every
// deploy. These tests exist because two one-time backfills lived here and
// silently reverted admin decisions each time the server restarted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { urlFor, runOn, scalar, column, recreateDatabase, dropDatabase } = require('./pgutil');

const DB = 'careers_seed_test';
const value = (sql) => scalar(DB, sql);
const exec = (sql) => runOn(DB, sql);
const count = async (table) => Number(await value(`SELECT COUNT(*) FROM ${table}`));

// Loads the app's own db/seed against a scratch database in a child process,
// so each call is a faithful "the server restarted" event
function boot({ sampleData = false } = {}) {
  const script = `
    const db = require('./db');
    const { initSchema } = require('./db/init');
    const seed = require('./db/seed');
    initSchema().then(() => seed(db)).then(() => db.pool.end())
      .catch((e) => { console.error(e.message); process.exit(1); });
  `;
  execFileSync(process.execPath, ['-e', script], {
    cwd: require('path').join(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: urlFor(DB),
      JWT_SECRET: 'seed-test',
      SEED_ADMIN_EMAIL: 'seed@test.local',
      SEED_ADMIN_PASSWORD: 'SeedPass123',
      SEED_SAMPLE_DATA: sampleData ? 'true' : '',
      SMTP_HOST: '',
      GOOGLE_DRIVE_FOLDER_ID: '',
      GOOGLE_OAUTH_CLIENT_ID: '',
      GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '',
    },
    stdio: 'pipe',
  });
}

test.after(() => dropDatabase(DB));

test('a fresh production database publishes nothing', async () => {
  await recreateDatabase(DB);
  boot();

  assert.equal(await count('openings'), 0, 'no sample vacancies');
  assert.equal(await count('branches'), 0, 'no sample branches');
  // The things a usable instance genuinely needs are still created
  assert.equal(await count('entities'), 2);
  assert.equal(await count('users'), 1);
  assert.ok(
    Number(await value("SELECT COUNT(*) FROM flow_options WHERE type = 'profile_stage'")) > 0
  );
});

test('sample data is available for development when asked for', async () => {
  await recreateDatabase(DB);
  boot({ sampleData: true });

  assert.ok((await count('openings')) > 0);
  assert.ok((await count('branches')) > 0);
});

test('restarting never reverts a decision an admin has made', async () => {
  await recreateDatabase(DB);
  boot({ sampleData: true });

  // An admin marks a role Non-Academic while an opening of the same name is
  // Academic - the exact conflict the old backfill resolved on every boot
  await exec(`INSERT INTO openings (position, branch, school_group, category)
              VALUES ('Lab Assistant', 'Pallavi Model School, Alwal', 'Pallavi', 'Academic')`);
  await exec(`INSERT INTO flow_options (type, key, label, category)
              VALUES ('suggested_role', 'lab_assistant', 'Lab Assistant', 'Non-Academic')`);

  // An admin deliberately moves a candidate who already has interview rounds
  // back to Shortlisted
  await exec(`INSERT INTO applications
                (full_name, mobile, email, qualification, position, branch, school_group, screening_status)
              VALUES ('Reverted Candidate', '9000000000', 'r@t.co', '', 'TGT',
                      'Pallavi Model School, Alwal', 'Pallavi', 'shortlisted')`);
  const appId = await value("SELECT id FROM applications WHERE full_name = 'Reverted Candidate'");
  await exec(`INSERT INTO interview_rounds (application_id, round_no, feedback, status)
              VALUES (${appId}, 1, 'interviewed', 'hold')`);

  // Three more deploys
  boot({ sampleData: true });
  boot({ sampleData: true });
  boot({ sampleData: true });

  assert.equal(
    await value("SELECT category FROM flow_options WHERE key = 'lab_assistant'"),
    'Non-Academic',
    "the admin's category must survive a restart"
  );
  assert.equal(
    await value(`SELECT screening_status FROM applications WHERE id = ${appId}`),
    'shortlisted',
    "the admin's stage decision must survive a restart"
  );
});

test('one-time migrations are recorded so they cannot reapply', async () => {
  await recreateDatabase(DB);
  boot();

  const flags = await column(
    DB,
    "SELECT key FROM app_settings WHERE key LIKE 'migration:%' ORDER BY key"
  );
  for (const expected of [
    'migration:applications_manage',
    'migration:in_interview_backfill',
    'migration:suggested_role_category',
  ]) {
    assert.ok(flags.includes(expected), `missing ${expected} (got ${JSON.stringify(flags)})`);
  }
});

test('deleting every opening on purpose survives a restart', async () => {
  await recreateDatabase(DB);
  boot({ sampleData: true });
  assert.ok((await count('openings')) > 0);

  // An admin clears the careers site deliberately
  await exec('DELETE FROM openings');
  boot({ sampleData: true });

  assert.equal(
    await count('openings'),
    0,
    'a restart must not resurrect openings an admin deleted'
  );
});
