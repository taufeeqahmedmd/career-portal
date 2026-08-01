const bcrypt = require('bcryptjs');

const ELIGIBILITY_VP =
  'Minimum 2 years experience in similar position and experience of teaching CBSE Curricula as TGT/PGT (mandatory). Eligibility - Postgraduate with M.Ed. / B.Ed. (M.Phil., Ph.D. will be added advantage) having experience in CBSE / International Curricula. Candidate must possess excellent communication skills, leadership qualities, proactive and is willing to lead a team of more than 100 members.';
const ELIGIBILITY_TGT = "Postgraduates / Graduates with B.Ed. having minimum 2 years' experience.";
const ELIGIBILITY_PRT = 'Postgraduates / Graduates with B.Ed. having minimum 1 year experience.';

const DEFAULT_OPENINGS = [
  { position: 'Vice Principal and Head Mistress', branch: 'Pallavi Model School, Alwal', school_group: 'Pallavi', eligibility: ELIGIBILITY_VP },
  { position: 'TGT - All Subjects', branch: 'Pallavi Model School, Boduppal', school_group: 'Pallavi', eligibility: ELIGIBILITY_TGT },
  { position: 'PRT - All Subjects', branch: 'Pallavi Model School, Bowenpally', school_group: 'Pallavi', eligibility: ELIGIBILITY_PRT },
  { position: 'TGT - All Subjects', branch: 'Pallavi Model School, Tirumalagiri', school_group: 'Pallavi', eligibility: ELIGIBILITY_TGT },
  { position: 'PRT - All Subjects', branch: 'Pallavi International School, Bachupally', school_group: 'Pallavi', eligibility: ELIGIBILITY_PRT },
  { position: 'Vice Principal and Head Mistress', branch: 'Pallavi International School, Keesara', school_group: 'Pallavi', eligibility: ELIGIBILITY_VP },
  { position: 'TGT - All Subjects', branch: 'Pallavi International School, Gandipet', school_group: 'Pallavi', eligibility: ELIGIBILITY_TGT },
  { position: 'PRT - All Subjects', branch: 'Pallavi Aware International School, Saroornaagar', school_group: 'Pallavi', eligibility: ELIGIBILITY_PRT },
  { position: 'TGT - All Subjects', branch: 'Pallavi International School, Pocharam', school_group: 'Pallavi', eligibility: ELIGIBILITY_TGT },
  { position: 'PRT - All Subjects', branch: 'Pallavi International School, Sagar Road', school_group: 'Pallavi', eligibility: ELIGIBILITY_PRT },
  { position: 'TGT - All Subjects', branch: 'Pallavi International School, Thumukunta', school_group: 'Pallavi', eligibility: ELIGIBILITY_TGT },
  { position: 'GGT - All Subjects', branch: 'Pallavi International School, Thumukunta', school_group: 'Pallavi', eligibility: ELIGIBILITY_TGT },
];

const slugify = (label, fallback) =>
  String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
  fallback;

// Sample branches and openings are useful on a developer's empty database and
// wrong on a real one - they would publish twelve vacancies nobody created.
// Opt in with SEED_SAMPLE_DATA=true; production leaves it unset.
const wantsSampleData = () =>
  String(process.env.SEED_SAMPLE_DATA || '').toLowerCase() === 'true';

// Runs `work` once per database, ever.
//
// This exists because seed() runs on EVERY boot. A backfill written for an
// upgrade ("move these rows to the new stage") is correct the first time and
// destructive afterwards: it reapplies itself over whatever an admin has
// changed since, silently undoing their decisions on every deploy. Anything
// that writes to rows a human can edit belongs in here.
async function runOnce(db, key, description, work, legacyKey) {
  const done = await db.get('SELECT value FROM app_settings WHERE key = ?', `migration:${key}`);
  if (done) return false;
  // A migration recorded under an older flag name must not run a second time
  if (legacyKey) {
    const legacy = await db.get('SELECT value FROM app_settings WHERE key = ?', legacyKey);
    if (legacy) {
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES (?, '1') ON CONFLICT (key) DO NOTHING",
        `migration:${key}`
      );
      return false;
    }
  }
  await work();
  await db.run(
    "INSERT INTO app_settings (key, value) VALUES (?, '1') ON CONFLICT (key) DO NOTHING",
    `migration:${key}`
  );
  console.log(`One-time migration applied: ${description}`);
  return true;
}

async function seed(db) {
  // Initial entities (school groups) - manageable from the admin UI afterwards
  const entityCount = (await db.get('SELECT COUNT(*) AS count FROM entities')).count;
  if (entityCount === 0) {
    await db.run('INSERT INTO entities (code, name, color) VALUES (?, ?, ?)', 'DPS', 'Delhi Public Schools', '#1e3a8a');
    await db.run('INSERT INTO entities (code, name, color) VALUES (?, ?, ?)', 'Pallavi', 'Pallavi Group of Schools', '#a81724');
    console.log('Seeded entities: DPS, Pallavi');
  }

  // System roles: Super Admin is untouchable; Admin is the editable default
  const roleCount = (await db.get('SELECT COUNT(*) AS count FROM roles')).count;
  if (roleCount === 0) {
    await db.run(
      'INSERT INTO roles (name, description, permissions, is_system) VALUES (?, ?, ?, 1)',
      'Super Admin',
      'Complete access to the entire application',
      JSON.stringify(['*'])
    );
    await db.run(
      'INSERT INTO roles (name, description, permissions, is_system) VALUES (?, ?, ?, 1)',
      'Admin',
      'Manages applications, openings and users within their assigned scope',
      JSON.stringify([
        'applications.view',
        'applications.manage',
        'applications.export',
        'openings.view',
        'openings.manage',
        'users.manage',
      ])
    );
    console.log('Seeded system roles: Super Admin, Admin');
  }

  // `applications.manage` split the old blanket write access out of
  // `applications.view`. Roles that could already write keep writing, so an
  // upgrade changes nothing until an admin narrows a role deliberately.
  // Runs once - re-running must not undo that narrowing.
  await runOnce(db, 'applications_manage', 'granted applications.manage to existing roles', async () => {
    const affected = await db.all(
      `SELECT id, permissions FROM roles
       WHERE permissions LIKE '%applications.view%'
         AND permissions NOT LIKE '%applications.manage%'`
    );
    for (const role of affected) {
      let perms = [];
      try {
        perms = JSON.parse(role.permissions || '[]');
      } catch {
        continue;
      }
      if (perms.includes('*') || !perms.includes('applications.view')) continue;
      perms.splice(perms.indexOf('applications.view') + 1, 0, 'applications.manage');
      await db.run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify(perms), role.id);
    }
  }, 'migrated_applications_manage');

  // Backfill role_id for users created before dynamic roles existed (idempotent)
  await db.run(
    `UPDATE users SET role_id = (
       SELECT id FROM roles WHERE name = CASE users.role WHEN 'super_admin' THEN 'Super Admin' ELSE 'Admin' END
     ) WHERE role_id IS NULL`
  );

  const userCount = (await db.get('SELECT COUNT(*) AS count FROM users')).count;
  if (userCount === 0) {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) {
      throw new Error(
        'No admin users exist. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to bootstrap the first super admin.'
      );
    }
    const superRoleId = (await db.get("SELECT id FROM roles WHERE name = 'Super Admin'")).id;
    await db.run(
      "INSERT INTO users (email, name, password_hash, role, role_id) VALUES (?, ?, ?, 'super_admin', ?)",
      email,
      'Super Admin',
      bcrypt.hashSync(password, 10),
      superRoleId
    );
    console.log(`Seeded super admin: ${email}`);
  }

  const branchCount = (await db.get('SELECT COUNT(*) AS count FROM branches')).count;
  const freshInstall = branchCount === 0;
  if (branchCount === 0) {
    // Existing installs: derive branches from openings already in the DB, so an
    // upgrade never loses the branches its openings refer to.
    const existing = await db.all('SELECT DISTINCT branch, school_group FROM openings');
    // A brand-new database only gets the sample branches when asked for them
    const source = existing.length
      ? existing.map((r) => ({ name: r.branch, school_group: r.school_group }))
      : wantsSampleData()
        ? [...new Map(DEFAULT_OPENINGS.map((o) => [o.branch, { name: o.branch, school_group: o.school_group }])).values()]
        : [];
    for (const b of source) {
      await db.run(
        'INSERT INTO branches (name, school_group) VALUES (?, ?) ON CONFLICT DO NOTHING',
        b.name,
        b.school_group
      );
    }
    if (source.length) console.log(`Seeded ${source.length} branches`);
  }

  // Hiring pipeline dropdown values - managed on the Flow Configuration page.
  const stageCount = (
    await db.get("SELECT COUNT(*) AS count FROM flow_options WHERE type = 'profile_stage'")
  ).count;
  if (stageCount === 0) {
    const stages = [
      ['new', 'New', '#0ea5e9', 1, 0],
      ['in_process', 'In Process', '#78716c', 1, 1],
      ['shortlisted', 'Shortlisted', '#059669', 1, 2],
      ['in_interview', 'In Interview', '#7c3aed', 1, 3],
      ['selected', 'Selected', '#1d4ed8', 0, 4],
      ['hold', 'Hold', '#d97706', 0, 5],
      ['not_selected', 'Not Selected', '#dc2626', 0, 6],
    ];
    for (const s of stages) {
      await db.run(
        "INSERT INTO flow_options (type, key, label, color, is_system, sort_order) VALUES ('profile_stage', ?, ?, ?, ?, ?)",
        ...s
      );
    }
    console.log('Seeded profile stage options');
  }

  // 'New' is the automatic status of every fresh application - it must exist
  // and stay a system value even on databases seeded before it was added
  const newStage = await db.get(
    "SELECT id, is_system FROM flow_options WHERE type = 'profile_stage' AND key = 'new'"
  );
  if (!newStage) {
    await db.run(
      "INSERT INTO flow_options (type, key, label, color, is_system, sort_order) VALUES ('profile_stage', 'new', 'New', '#0ea5e9', 1, 0)"
    );
  } else if (!newStage.is_system) {
    await db.run(
      'UPDATE flow_options SET is_system = 1, is_active = 1, sort_order = 0 WHERE id = ?',
      newStage.id
    );
  }

  // 'In Interview' is set automatically when an interview round is saved
  const interviewStage = await db.get(
    "SELECT id FROM flow_options WHERE type = 'profile_stage' AND key = 'in_interview'"
  );
  if (!interviewStage) {
    await db.run(
      "UPDATE flow_options SET sort_order = sort_order + 1 WHERE type = 'profile_stage' AND sort_order >= 3"
    );
    await db.run(
      "INSERT INTO flow_options (type, key, label, color, is_system, sort_order) VALUES ('profile_stage', 'in_interview', 'In Interview', '#7c3aed', 1, 3)"
    );
    console.log('Added the In Interview stage');
  }

  // Candidates that already had interview rounds when the In Interview stage
  // was introduced move to it. ONCE: re-running would drag a candidate an admin
  // deliberately moved back to Shortlisted forward again on every restart.
  await runOnce(db, 'in_interview_backfill', 'moved existing interviewees to In Interview', () =>
    db.run(
      `UPDATE applications SET screening_status = 'in_interview'
       WHERE screening_status = 'shortlisted'
         AND EXISTS (SELECT 1 FROM interview_rounds r WHERE r.application_id = applications.id)`
    )
  );

  // Applications submitted before the pipeline existed start as 'new' too.
  // Safe to repeat: it only fills in a value that is missing entirely.
  await db.run(
    "UPDATE applications SET screening_status = 'new' WHERE screening_status IS NULL OR screening_status = ''"
  );

  // Every application's timeline starts with its submission (idempotent backfill)
  await db.run(
    `INSERT INTO application_activity (application_id, action, detail, created_at)
     SELECT a.id, 'submitted', a.position || ' - ' || a.branch, a.created_at
     FROM applications a
     WHERE NOT EXISTS (
       SELECT 1 FROM application_activity x
       WHERE x.application_id = a.id AND x.action = 'submitted'
     )`
  );

  // Initial "Assign To" values - derived once from active admin users
  const assigneeCount = (
    await db.get("SELECT COUNT(*) AS count FROM flow_options WHERE type = 'assignee'")
  ).count;
  if (assigneeCount === 0) {
    const names = await db.all('SELECT name FROM users WHERE is_active = 1 ORDER BY name');
    let i = 0;
    for (const u of names) {
      i += 1;
      await db.run(
        "INSERT INTO flow_options (type, key, label, sort_order) VALUES ('assignee', ?, ?, ?) ON CONFLICT DO NOTHING",
        slugify(u.name, `person_${i}`),
        u.name,
        i
      );
    }
    if (names.length) console.log(`Seeded ${names.length} assignee options`);
  }

  // Initial "Roles / Positions" values - derived once from distinct positions
  const suggestedCount = (
    await db.get("SELECT COUNT(*) AS count FROM flow_options WHERE type = 'suggested_role'")
  ).count;
  if (suggestedCount === 0) {
    const positions = await db.all('SELECT DISTINCT position FROM openings ORDER BY position');
    let i = 0;
    for (const p of positions) {
      i += 1;
      await db.run(
        "INSERT INTO flow_options (type, key, label, sort_order) VALUES ('suggested_role', ?, ?, ?) ON CONFLICT DO NOTHING",
        slugify(p.position, `role_${i}`),
        p.position,
        i
      );
    }
    if (positions.length) console.log(`Seeded ${positions.length} suggested role options`);
  }

  // Roles were given the category of the openings using them when the
  // Academic / Non-Academic split was introduced. ONCE: the category is
  // editable on the Flow Configuration page, so repeating this would overwrite
  // an admin's choice with whatever the matching opening happens to say.
  await runOnce(db, 'suggested_role_category', 'derived role categories from openings', () =>
    db.run(
      `UPDATE flow_options SET category = (
         SELECT o.category FROM openings o
         WHERE LOWER(o.position) = LOWER(flow_options.label)
         ORDER BY o.id DESC LIMIT 1
       )
       WHERE type = 'suggested_role'
         AND EXISTS (
           SELECT 1 FROM openings o WHERE LOWER(o.position) = LOWER(flow_options.label)
         )`
    )
  );

  // Sample openings only on a truly fresh install, and only when explicitly
  // requested. A production database must not come up publishing a dozen
  // vacancies nobody created; and if admins later delete every opening on
  // purpose, a restart must not resurrect them.
  const openingCount = (await db.get('SELECT COUNT(*) AS count FROM openings')).count;
  if (openingCount === 0 && freshInstall && wantsSampleData()) {
    for (const o of DEFAULT_OPENINGS) {
      await db.run(
        'INSERT INTO openings (position, branch, school_group, eligibility) VALUES (?, ?, ?, ?)',
        o.position,
        o.branch,
        o.school_group,
        o.eligibility
      );
    }
    console.log(`Seeded ${DEFAULT_OPENINGS.length} job openings`);
  }
}

module.exports = seed;

if (require.main === module) {
  require('dotenv').config();
  const db = require('./index');
  const { initSchema } = require('./init');
  initSchema()
    .then(() => seed(db))
    .then(() => {
      console.log('Seed complete.');
      return db.pool.end();
    })
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exit(1);
    });
}
