// Database access for the test harness.
//
// Uses the `pg` client directly rather than shelling out to `docker exec psql`,
// so the suite runs anywhere it can reach PostgreSQL: a developer's Docker
// container, a CI service container, or a remote host.
//
// TEST_PG_URL points at the server (no database), default local Docker.
//
// TEST_PG_ADMIN_URL is where CREATE/DROP DATABASE go. It matters when
// TEST_PG_URL is a PgBouncer instance: a pooler only routes the databases it
// was configured for, and DDL like CREATE DATABASE cannot run through a
// transaction-pooled connection at all. Defaults to TEST_PG_URL when the two
// are the same server.
const { Client } = require('pg');

const strip = (url) => String(url).replace(/\/+$/, '');

const BASE_URL = strip(process.env.TEST_PG_URL || 'postgres://careers:careers@localhost:5432');
const ADMIN_URL = strip(process.env.TEST_PG_ADMIN_URL || BASE_URL);

const urlFor = (database) => `${BASE_URL}/${database}`;
const adminUrlFor = (database) => `${ADMIN_URL}/${database}`;

async function runWith(url, sql, params) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

const runOn = (database, sql, params) => runWith(urlFor(database), sql, params);

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

// CREATE/DROP DATABASE cannot run inside the target database, and must bypass
// any connection pooler in front of it
const admin = (sql) => runWith(adminUrlFor('postgres'), sql);

async function recreateDatabase(name) {
  await admin(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`
  ).catch(() => {});
  await admin(`DROP DATABASE IF EXISTS ${name}`);
  await admin(`CREATE DATABASE ${name}`);
}

async function dropDatabase(name) {
  try {
    await admin(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`
    );
    await admin(`DROP DATABASE IF EXISTS ${name}`);
  } catch {
    // Teardown is best effort
  }
}

module.exports = {
  BASE_URL,
  ADMIN_URL,
  urlFor,
  runOn,
  runWith,
  scalar,
  column,
  recreateDatabase,
  dropDatabase,
};
