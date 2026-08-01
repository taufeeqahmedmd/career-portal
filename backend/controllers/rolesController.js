const db = require('../db');
const { PERMISSIONS, PERMISSION_KEYS } = require('../utils/permissions');
const { validId } = require('../utils/validate');

// A role may never be given a permission its author does not already hold.
// Without this, `roles.manage` is indistinguishable from full access: the
// holder simply edits their own role and grants themselves everything.
function exceedsActorPermissions(actor, permissions = []) {
  const actorPerms = actor?.permissions || [];
  if (actorPerms.includes('*')) return null; // super admin
  if (permissions.includes('*')) return 'You cannot grant full access.';
  const extra = permissions.filter((p) => !actorPerms.includes(p));
  if (extra.length) {
    return `You cannot grant permissions you do not have: ${extra.join(', ')}.`;
  }
  return null;
}

async function serializeRole(row) {
  let permissions = [];
  try {
    permissions = JSON.parse(row.permissions || '[]');
  } catch {}
  const users_count = (
    await db.get('SELECT COUNT(*) AS count FROM users WHERE role_id = ?', row.id)
  ).count;
  return { ...row, permissions, users_count };
}

function validatePermissions(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return 'Select at least one permission.';
  }
  const invalid = list.filter((p) => !PERMISSION_KEYS.includes(p));
  if (invalid.length) return `Unknown permission(s): ${invalid.join(', ')}`;
  return null;
}

// The catalog the UI builds checkboxes from
exports.catalog = (req, res) => {
  res.json({ permissions: PERMISSIONS });
};

exports.list = async (req, res) => {
  const rows = await db.all('SELECT * FROM roles ORDER BY is_system DESC, name');
  const roles = [];
  for (const r of rows) roles.push(await serializeRole(r));
  res.json({ roles });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const name = (body.name || '').trim();
  const description = (body.description || '').trim();

  if (!name) return res.status(400).json({ error: 'Role name is required.' });
  const permError = validatePermissions(body.permissions);
  if (permError) return res.status(400).json({ error: permError });
  const escalation = exceedsActorPermissions(req.user, body.permissions);
  if (escalation) return res.status(403).json({ error: escalation });

  const existing = await db.get('SELECT id FROM roles WHERE LOWER(name) = LOWER(?)', name);
  if (existing) return res.status(409).json({ error: 'A role with this name already exists.' });

  const result = await db.run(
    'INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?) RETURNING id',
    name,
    description,
    JSON.stringify(body.permissions)
  );

  res.status(201).json({
    role: await serializeRole(await db.get('SELECT * FROM roles WHERE id = ?', result.rows[0].id)),
  });
};

exports.update = async (req, res) => {
  const role = await db.get('SELECT * FROM roles WHERE id = ?', validId(req.params.id));
  if (!role) return res.status(404).json({ error: 'Role not found.' });
  if (role.is_system && role.name === 'Super Admin') {
    return res.status(400).json({ error: 'The Super Admin role cannot be modified.' });
  }

  // Editing a role you already hold is the shortest path to self-escalation,
  // and editing a system role silently re-permissions everyone who holds it
  const isOwnRole = req.user?.role_id === role.id;
  const actorIsSuper = (req.user?.permissions || []).includes('*');
  if (isOwnRole && !actorIsSuper) {
    return res
      .status(403)
      .json({ error: 'You cannot edit the role assigned to your own account.' });
  }
  if (role.is_system && !actorIsSuper) {
    return res.status(403).json({ error: 'Only a super admin can change a system role.' });
  }

  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : role.name;
  const description =
    body.description !== undefined ? String(body.description).trim() : role.description;
  let permissions = role.permissions;
  let is_active = role.is_active;

  if (!name) return res.status(400).json({ error: 'Role name is required.' });
  if (role.is_system && name !== role.name) {
    return res.status(400).json({ error: 'System role names cannot be changed.' });
  }

  if (body.permissions !== undefined) {
    const permError = validatePermissions(body.permissions);
    if (permError) return res.status(400).json({ error: permError });
    const escalation = exceedsActorPermissions(req.user, body.permissions);
    if (escalation) return res.status(403).json({ error: escalation });
    permissions = JSON.stringify(body.permissions);
  }

  if (body.is_active !== undefined) {
    if (role.is_system && !body.is_active) {
      return res.status(400).json({ error: 'System roles cannot be deactivated.' });
    }
    is_active = body.is_active ? 1 : 0;
  }

  const duplicate = await db.get(
    'SELECT id FROM roles WHERE LOWER(name) = LOWER(?) AND id != ?',
    name,
    role.id
  );
  if (duplicate) return res.status(409).json({ error: 'A role with this name already exists.' });

  await db.run(
    'UPDATE roles SET name = ?, description = ?, permissions = ?, is_active = ? WHERE id = ?',
    name,
    description,
    permissions,
    is_active,
    role.id
  );

  res.json({ role: await serializeRole(await db.get('SELECT * FROM roles WHERE id = ?', role.id)) });
};

exports.remove = async (req, res) => {
  const role = await db.get('SELECT * FROM roles WHERE id = ?', validId(req.params.id));
  if (!role) return res.status(404).json({ error: 'Role not found.' });
  if (role.is_system) {
    return res.status(400).json({ error: 'System roles cannot be deleted.' });
  }
  if (req.user?.role_id === role.id) {
    return res.status(400).json({ error: 'You cannot delete the role assigned to your own account.' });
  }

  const inUse = (await db.get('SELECT COUNT(*) AS count FROM users WHERE role_id = ?', role.id))
    .count;
  if (inUse > 0) {
    return res.status(409).json({
      error: `${inUse} user(s) currently have this role. Reassign them before deleting it.`,
    });
  }

  await db.run('DELETE FROM roles WHERE id = ?', role.id);
  res.json({ success: true });
};
