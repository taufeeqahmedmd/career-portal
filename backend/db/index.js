const { Pool, types } = require('pg');

// COUNT(*) & friends come back as int8 - parse to number so arithmetic works
types.setTypeParser(20, (v) => parseInt(v, 10));
// DATE columns stay plain 'YYYY-MM-DD' strings (the trend feed depends on it)
types.setTypeParser(1082, (v) => v);

// The session runs in UTC so date maths matches the old SQLite behaviour
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://careers:careers@localhost:5432/careers',
  options: '-c TimeZone=UTC',
  max: Number(process.env.PG_POOL_SIZE || 10),
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
