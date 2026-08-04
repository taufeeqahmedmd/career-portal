const db = require('../db');

const { scopeFor } = require('../utils/scope');
const { remember, invalidate, KEYS } = require('../utils/cache');
const { isActiveEntityCode } = require('./entitiesController');
const { validId } = require('../utils/validate');

// Public: active branches of active entities, with their live openings count
exports.publicList = async (req, res) => {
  const branches = await db.all(
    `SELECT b.id, b.name, b.school_group, COUNT(o.id) AS openings_count
     FROM branches b
     JOIN entities e ON e.code = b.school_group AND e.is_active = 1
     LEFT JOIN openings o
       ON o.branch = b.name AND o.school_group = b.school_group AND o.is_active = 1
     WHERE b.is_active = 1
     GROUP BY b.id
     ORDER BY b.school_group, b.name`
  );
  res.json({ branches });
};

// Cached per scope, never under one shared key: a branch-scoped admin must
// not be served the unrestricted list because someone else warmed the cache.
exports.list = async (req, res) => {
  const scope = scopeFor(req.user);
  const key = scope.branchId ? `b${scope.branchId}` : scope.group ? `g${scope.group}` : 'all';

  const branches = await remember(`${KEYS.branches}list:${key}`, () => {
    if (scope.branchId) {
      return db.all('SELECT * FROM branches WHERE id = ?', scope.branchId);
    }
    if (scope.group) {
      return db.all('SELECT * FROM branches WHERE school_group = ? ORDER BY name', scope.group);
    }
    return db.all('SELECT * FROM branches ORDER BY school_group, name');
  });

  res.json({ branches });
};

// A scoped admin may only touch branches inside their own entity/branch
function outOfScope(user, branchLike) {
  const scope = scopeFor(user);
  if (scope.branchId && branchLike.id !== scope.branchId) {
    return 'You can only manage your own branch.';
  }
  if (scope.group && branchLike.school_group !== scope.group) {
    return 'You can only manage branches for your school group.';
  }
  return null;
}

exports.create = async (req, res) => {
  const body = req.body || {};
  const name = String(body.name == null ? '' : body.name).trim();
  const school_group = String(body.school_group == null ? '' : body.school_group).trim();

  if (!name) return res.status(400).json({ error: 'Branch name is required.' });
  if (name.length > 120) {
    return res.status(400).json({ error: 'Branch name is too long (maximum 120 characters).' });
  }
  const scope = scopeFor(req.user);
  if (scope.branchId) {
    return res.status(403).json({ error: 'Branch-scoped users cannot create branches.' });
  }
  if (scope.group && school_group !== scope.group) {
    return res.status(403).json({ error: 'You can only create branches for your school group.' });
  }
  if (!(await isActiveEntityCode(school_group))) {
    return res.status(400).json({ error: 'Select a valid, active entity.' });
  }

  const existing = await db.get(
    'SELECT id FROM branches WHERE school_group = ? AND LOWER(name) = LOWER(?)',
    school_group,
    name
  );
  if (existing) {
    return res.status(409).json({ error: 'This branch already exists for that school group.' });
  }

  const result = await db.run(
    'INSERT INTO branches (name, school_group) VALUES (?, ?) RETURNING id',
    name,
    school_group
  );
  const branch = await db.get('SELECT * FROM branches WHERE id = ?', result.rows[0].id);
  await invalidate(KEYS.branches);
  await invalidate(KEYS.entities);
  res.status(201).json({ branch });
};

exports.update = async (req, res) => {
  const branch = await db.get('SELECT * FROM branches WHERE id = ?', validId(req.params.id));
  if (!branch) return res.status(404).json({ error: 'Branch not found.' });

  const denied = outOfScope(req.user, branch);
  if (denied) return res.status(403).json({ error: denied });

  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : branch.name;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : branch.is_active;

  if (!name) return res.status(400).json({ error: 'Branch name is required.' });
  if (name.length > 120) {
    return res.status(400).json({ error: 'Branch name is too long (maximum 120 characters).' });
  }

  const duplicate = await db.get(
    'SELECT id FROM branches WHERE school_group = ? AND LOWER(name) = LOWER(?) AND id != ?',
    branch.school_group,
    name,
    branch.id
  );
  if (duplicate) {
    return res.status(409).json({ error: 'This branch already exists for that school group.' });
  }

  // Openings and applications reference the branch by name, so a rename has to
  // carry through or they are orphaned and vanish from branch-scoped views.
  const renamed = name !== branch.name;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE branches SET name = $1, is_active = $2 WHERE id = $3', [
      name,
      isActive,
      branch.id,
    ]);
    if (renamed) {
      await client.query('UPDATE openings SET branch = $1 WHERE branch = $2 AND school_group = $3', [
        name,
        branch.name,
        branch.school_group,
      ]);
      await client.query(
        'UPDATE applications SET branch = $1 WHERE branch = $2 AND school_group = $3',
        [name, branch.name, branch.school_group]
      );
      await client.query(
        'UPDATE applications SET referred_branch = $1 WHERE referred_branch = $2 AND referred_entity = $3',
        [name, branch.name, branch.school_group]
      );
      await client.query('UPDATE users SET branch_id = branch_id WHERE branch_id = $1', [branch.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const updated = await db.get('SELECT * FROM branches WHERE id = ?', branch.id);
  await invalidate(KEYS.branches);
  await invalidate(KEYS.entities);
  res.json({ branch: updated });
};

exports.remove = async (req, res) => {
  const branch = await db.get('SELECT * FROM branches WHERE id = ?', validId(req.params.id));
  if (!branch) return res.status(404).json({ error: 'Branch not found.' });

  const denied = outOfScope(req.user, branch);
  if (denied) return res.status(403).json({ error: denied });

  // Openings and applications reference a branch by name, not by id, so
  // deleting the row does not remove them - it strands them. A closed opening
  // is just as stranded as an open one: reopening it later would never show on
  // the careers site, because the public listing joins back to branches.
  const openings = (
    await db.get(
      'SELECT COUNT(*) AS count FROM openings WHERE branch = ? AND school_group = ?',
      branch.name,
      branch.school_group
    )
  ).count;
  if (openings > 0) {
    return res.status(409).json({
      error: `This branch has ${openings} opening(s), including closed ones. Delete or move them before removing the branch.`,
    });
  }

  const applications = (
    await db.get(
      `SELECT COUNT(*) AS count FROM applications
       WHERE (branch = ? AND school_group = ?)
          OR (referred_branch = ? AND referred_entity = ?)`,
      branch.name,
      branch.school_group,
      branch.name,
      branch.school_group
    )
  ).count;
  if (applications > 0) {
    return res.status(409).json({
      error: `This branch has ${applications} application(s) on record. Deactivate the branch instead - its history stays intact and it disappears from the careers site.`,
    });
  }

  // users.branch_id is a real FK - report it rather than letting PG raise a 500
  const assignedUsers = (
    await db.get('SELECT COUNT(*) AS count FROM users WHERE branch_id = ?', branch.id)
  ).count;
  if (assignedUsers > 0) {
    return res.status(409).json({
      error: `This branch has ${assignedUsers} user(s) assigned. Reassign them before removing the branch.`,
    });
  }

  await db.run('DELETE FROM branches WHERE id = ?', branch.id);
  await invalidate(KEYS.branches);
  await invalidate(KEYS.entities);
  res.json({ success: true });
};
