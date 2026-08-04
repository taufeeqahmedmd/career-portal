const { Pool, types } = require('pg');

// COUNT(*) & friends come back as int8 - parse to number so arithmetic works
types.setTypeParser(20, (v) => parseInt(v, 10));
// DATE columns stay plain 'YYYY-MM-DD' strings (the trend feed depends on it)
types.setTypeParser(1082, (v) => v);

// Sessions run in UTC. This is set on the SERVER (see db/init.js), not as a
// connection startup parameter: PgBouncer refuses unknown startup parameters,
// and under transaction pooling a per-session SET would not survive being
// handed to the next client anyway. Every date calculation in the app is
// explicit about its timezone regardless (`AT TIME ZONE`), so this is a
// belt-and-braces default rather than something behaviour depends on.
//
// PG_POOL_SIZE is the pool this process keeps. Behind PgBouncer it can stay
// small - PgBouncer is what multiplexes onto real PostgreSQL connections.
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://careers:careers@localhost:5432/careers',
  max: Number(process.env.PG_POOL_SIZE || 10),
  // Do not hold idle connections open through a pooler indefinitely
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// Queries are written with `?` placeholders (as before); converted to $1..$n here
const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

const query = (sql, params = []) => pool.query(toPg(sql), params);

// First row or undefined
const get = async (sql, ...params) => (await query(sql, params)).rows[0];

// All rows
const all = async (sql, ...params) => (await query(sql, params)).rows;

// Mutation; `changes` mirrors better-sqlite3, `rows` carries RETURNING data
const run = async (sql, ...params) => {
  const result = await query(sql, params);
  return { changes: result.rowCount, rows: result.rows };
};

module.exports = { pool, query, get, all, run };
