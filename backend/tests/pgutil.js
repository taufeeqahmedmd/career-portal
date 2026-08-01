// Database access for the test harness.
//
// Uses the `pg` client directly rather than shelling out to `docker exec psql`,
// so the suite runs anywhere it can reach PostgreSQL: a developer's Docker
// container, a CI service container, or a remote host.
//
// TEST_PG_URL points at the server (no database), default local Docker.
const { Client } = require('pg');

const BASE_URL = (process.env.TEST_PG_URL || 'postgres://careers:careers@localhost:5432').replace(
  /\/+$/,
  ''
);

const urlFor = (database) => `${BASE_URL}/${database}`;

async function runOn(database, sql) {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

// Single scalar value, as a trimmed string - mirrors `psql -tAc`
async function scalar(database, sql) {
  const res = await runOn(database, sql);
  const row = res.rows[0];
  if (!row) return '';
  return String(Object.values(row)[0] ?? '').trim();
}

async function column(database, sql) {
  const res = await runOn(database, sql);
  return res.rows.map((r) => String(Object.values(r)[0] ?? ''));
}

// CREATE/DROP DATABASE cannot run inside the target database
async function recreateDatabase(name) {
  await runOn(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`
  ).catch(() => {});
  await runOn('postgres', `DROP DATABASE IF EXISTS ${name}`);
  await runOn('postgres', `CREATE DATABASE ${name}`);
}

async function dropDatabase(name) {
  try {
    await runOn(
      'postgres',
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`
    );
    await runOn('postgres', `DROP DATABASE IF EXISTS ${name}`);
  } catch {
    // Teardown is best effort
  }
}

module.exports = { BASE_URL, urlFor, runOn, scalar, column, recreateDatabase, dropDatabase };
