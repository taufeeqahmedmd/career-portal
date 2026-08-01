const db = require('../db');
const { scopeFor } = require('../utils/scope');
const { validId, str } = require('../utils/validate');

const HEX = /^#[0-9a-fA-F]{6}$/;

// Public: active entities for labels/colors on the careers site
exports.publicList = async (req, res) => {
  const entities = await db.all(
    'SELECT code, name, color FROM entities WHERE is_active = 1 ORDER BY name'
  );
  res.json({ entities });
};

// Admin: all entities with usage counts
exports.list = async (req, res) => {
  const rows = await db.all('SELECT * FROM entities ORDER BY name');
  const entities = [];
  for (const e of rows) {
    entities.push({
      ...e,
      branches_count: (
        await db.get('SELECT COUNT(*) AS c FROM branches WHERE school_group = ?', e.code)
      ).c,
      openings_count: (
        await db.get(
          'SELECT COUNT(*) AS c FROM openings WHERE school_group = ? AND is_active = 1',
          e.code
        )
      ).c,
    });
  }
  res.json({ entities });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const code = str(body.code);
  const name = str(body.name);
  const color = str(body.color) || '#1e3a8a';

  // Entity creation is a global act - a scoped admin has no business doing it
  const scope = scopeFor(req.user);
  if (scope.group || scope.branchId) {
    return res.status(403).json({ error: 'Only unscoped administrators can create entities.' });
  }

  if (!code) return res.status(400).json({ error: 'Entity code is required.' });
  if (!/^[A-Za-z0-9-]{2,20}$/.test(code)) {
    return res.status(400).json({ error: 'Code must be 2-20 letters/numbers (e.g. DPS).' });
  }
  if (!name) return res.status(400).json({ error: 'Entity name is required.' });
  if (!HEX.test(color)) return res.status(400).json({ error: 'Color must be a hex value like #1e3a8a.' });

  const existing = await db.get('SELECT id FROM entities WHERE LOWER(code) = LOWER(?)', code);
  if (existing) return res.status(409).json({ error: 'An entity with this code already exists.' });

  const result = await db.run(
    'INSERT INTO entities (code, name, color) VALUES (?, ?, ?) RETURNING id',
    code,
    name,
    color
  );
  res
    .status(201)
    .json({ entity: await db.get('SELECT * FROM entities WHERE id = ?', result.rows[0].id) });
};

// A scoped admin may only edit their own entity, and never delete one
function entityOutOfScope(user, entity) {
  const scope = scopeFor(user);
  if ((scope.group || scope.branchId) && entity.code !== scope.group) {
    return 'You can only manage your own school group.';
  }
  return null;
}

exports.update = async (req, res) => {
  const entity = await db.get('SELECT * FROM entities WHERE id = ?', validId(req.params.id));
  if (!entity) return res.status(404).json({ error: 'Entity not found.' });

  const denied = entityOutOfScope(req.user, entity);
  if (denied) return res.status(403).json({ error: denied });

  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : entity.name;
  const color = body.color !== undefined ? String(body.color).trim() : entity.color;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : entity.is_active;

  if (!name) return res.status(400).json({ error: 'Entity name is required.' });
  if (!HEX.test(color)) return res.status(400).json({ error: 'Color must be a hex value like #1e3a8a.' });

  // Code is the join key across branches/openings/users - it stays fixed
  await db.run(
    'UPDATE entities SET name = ?, color = ?, is_active = ? WHERE id = ?',
    name,
    color,
    isActive,
    entity.id
  );
  res.json({ entity: await db.get('SELECT * FROM entities WHERE id = ?', entity.id) });
};

exports.remove = async (req, res) => {
  const entity = await db.get('SELECT * FROM entities WHERE id = ?', validId(req.params.id));
  if (!entity) return res.status(404).json({ error: 'Entity not found.' });

  const scope = scopeFor(req.user);
  if (scope.group || scope.branchId) {
    return res.status(403).json({ error: 'Only unscoped administrators can delete entities.' });
  }

  const branches = (
    await db.get('SELECT COUNT(*) AS c FROM branches WHERE school_group = ?', entity.code)
  ).c;
  const openings = (
    await db.get('SELECT COUNT(*) AS c FROM openings WHERE school_group = ?', entity.code)
  ).c;
  const users = (
    await db.get('SELECT COUNT(*) AS c FROM users WHERE school_group = ?', entity.code)
  ).c;
  const applications = (
    await db.get('SELECT COUNT(*) AS c FROM applications WHERE school_group = ?', entity.code)
  ).c;

  const inUse = branches + openings + users + applications;
  if (inUse > 0) {
    return res.status(409).json({
      error: `This entity is used by ${branches} branch(es), ${openings} opening(s), ${users} user(s) and ${applications} application(s). Deactivate it instead.`,
    });
  }

  await db.run('DELETE FROM entities WHERE id = ?', entity.id);
  res.json({ success: true });
};

// Shared validation helper for other controllers
exports.isActiveEntityCode = async (code) =>
  !!(await db.get('SELECT id FROM entities WHERE code = ? AND is_active = 1', code));
