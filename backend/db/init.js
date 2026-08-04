const fs = require('fs');
const path = require('path');
const db = require('./index');

// Applies the schema. Every statement is idempotent (IF NOT EXISTS), so this
// runs safely on every boot; column-level migrations belong in migrate() below.
async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.pool.query(schema);
  await ensureUtcDefault();
  await migrate();
}

// The application used to ask for UTC as a connection startup parameter, which
// PgBouncer rejects. Setting it on the database instead means every connection
// inherits it however it arrives - directly or through a pooler.
async function ensureUtcDefault() {
  try {
    const current = await db.get('SHOW timezone');
    if (String(current.TimeZone || current.timezone).toUpperCase() === 'UTC') return;
    const { rows } = await db.pool.query('SELECT current_database() AS name');
    await db.pool.query(`ALTER DATABASE "${rows[0].name}" SET timezone TO 'UTC'`);
    console.log('Migrated: database timezone set to UTC');
  } catch (err) {
    // Needs database-owner rights. Not fatal: every date calculation in the app
    // states its own timezone explicitly.
    console.warn('Could not set the database timezone to UTC:', err.message);
  }
}

// Additive migrations for databases created before a column existed
async function migrate() {
  const addColumn = async (table, column, ddl) => {
    const exists = await db.get(
      `SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      table,
      column
    );
    if (!exists) {
      await db.pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      console.log(`Migrated: ${table}.${column}`);
    }
  };

  await addColumn('users', 'password_changed_at', 'password_changed_at TIMESTAMPTZ');
  await addColumn('export_otps', 'filter_key', "filter_key TEXT NOT NULL DEFAULT ''");
  // Existing accounts keep their working password - only new ones are forced
  await addColumn(
    'users',
    'must_change_password',
    'must_change_password INTEGER NOT NULL DEFAULT 0'
  );
  await addColumn('users', 'totp_enabled', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
  await addColumn('users', 'totp_secret', 'totp_secret TEXT');
  await addColumn('users', 'totp_confirmed_at', 'totp_confirmed_at TIMESTAMPTZ');
  await addColumn('users', 'totp_last_step', 'totp_last_step BIGINT');
  await addColumn('users', 'totp_attempts', 'totp_attempts INTEGER NOT NULL DEFAULT 0');

  await ensureNoDuplicateApplications();
}

// "One application per position per phone number" is checked in the controller
// before inserting, but that check is a race: simultaneous submits all pass it
// and every one of them is written. A unique index is what actually enforces
// the rule - the controller's check just turns the violation into a friendly
// message.
//
// Existing databases may already contain duplicates from that race. Deleting
// applicant records to make an index fit is not this function's call, so it
// reports them and leaves them alone; the index is created once they are gone.
async function ensureNoDuplicateApplications() {
  const exists = await db.get(
    `SELECT 1 FROM pg_indexes WHERE indexname = 'uq_applications_opening_mobile'`
  );
  if (exists) return;

  const duplicates = await db.all(
    `SELECT opening_id, mobile, COUNT(*) AS count, MIN(id) AS keep_id,
            STRING_AGG(id::text, ', ' ORDER BY id) AS ids
     FROM applications
     WHERE opening_id IS NOT NULL
     GROUP BY opening_id, mobile
     HAVING COUNT(*) > 1`
  );

  if (duplicates.length) {
    console.warn(
      `\nDuplicate applications block the uq_applications_opening_mobile index.\n` +
        `Review these and delete the ones you do not want to keep, then restart:`
    );
    for (const d of duplicates) {
      console.warn(
        `  opening ${d.opening_id}, mobile ${d.mobile}: ids ${d.ids} (oldest is ${d.keep_id})`
      );
    }
    console.warn(
      'Until then duplicate submissions stay possible under concurrent load.\n'
    );
    return;
  }

  await db.pool.query(
    'CREATE UNIQUE INDEX uq_applications_opening_mobile ON applications(opening_id, mobile)'
  );
  console.log('Migrated: unique index on applications(opening_id, mobile)');
}

module.exports = { initSchema };
