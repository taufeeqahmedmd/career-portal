// One-time data migration: copies everything from the old SQLite database into
// PostgreSQL, preserving ids, then fixes the id sequences.
//
//   node scripts/migrate-sqlite-to-pg.js [path-to-careers.db]
//
// Safe to re-run: rows whose id already exists in PostgreSQL are skipped.

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../db');
const { initSchema } = require('../db/init');

const sqlitePath =
  process.argv[2] || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'careers.db');

// Insertion order respects foreign keys
const TABLES = [
  'roles',
  'entities',
  'branches',
  'users',
  'openings',
  'applications',
  'interview_rounds',
  'application_activity',
  'flow_options',
  'export_otps',
];

// SQLite stored timestamps as 'YYYY-MM-DD HH:MM:SS' in UTC
const TIMESTAMP_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'last_login_at',
  'last_activity_at',
  'used_at',
  'expires_at',
]);

const toPgValue = (column, value) => {
  if (value == null) return null;
  if (TIMESTAMP_COLUMNS.has(column) && typeof value === 'string' && value.trim()) {
    return `${value.replace(' ', 'T')}Z`; // explicit UTC
  }
  return value;
};

async function migrateTable(sqlite, table) {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (!rows.length) {
    console.log(`  ${table}: nothing to copy`);
    return;
  }

  // Only columns that exist on both sides survive the copy
  const pgColumns = (
    await db.all(
      'SELECT column_name FROM information_schema.columns WHERE table_name = ?',
      table
    )
  ).map((r) => r.column_name);
  const columns = Object.keys(rows[0]).filter((c) => pgColumns.includes(c));

  let copied = 0;
  let skipped = 0;
  for (const row of rows) {
    const exists = await db.get(`SELECT 1 FROM ${table} WHERE id = ?`, row.id);
    if (exists) {
      skipped += 1;
      continue;
    }
    const values = columns.map((c) => toPgValue(c, row[c]));
    await db.run(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      ...values
    );
    copied += 1;
  }
  console.log(`  ${table}: ${copied} copied${skipped ? `, ${skipped} already present` : ''}`);
}

async function fixSequence(table) {
  await db.pool.query(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}))`
  );
}

async function main() {
  console.log(`Reading SQLite database: ${sqlitePath}`);
  const sqlite = new Database(sqlitePath, { readonly: true });

  console.log('Preparing PostgreSQL schema…');
  await initSchema();

  console.log('Copying data…');
  for (const table of TABLES) {
    await migrateTable(sqlite, table);
  }

  console.log('Resetting id sequences…');
  for (const table of TABLES) {
    await fixSequence(table);
  }

  sqlite.close();
  await db.pool.end();
  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
