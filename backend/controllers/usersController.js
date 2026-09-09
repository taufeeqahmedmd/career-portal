const bcrypt = require('bcryptjs');
const db = require('../db');
const { scopeFor, isBranchScoped, inList } = require('../utils/scope');
const { can } = require('../utils/permissions');
const { sendWelcomeEmail, isConfigured: mailConfigured } = require('../utils/mailer');
const { parseCsvFile, pick, MAX_ROWS, checkHeaders, HEADER_RULES } = require('../utils/csvImport');
const { validId, toBool, str } = require('../utils/validate');

// Every account is created on this password and cannot use the portal until it
// has been replaced - see requirePasswordChanged in middlewares/auth.js
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '12345678';

// school_group/branch_id are the legacy single-value columns, kept in step with
// the first entry of each assignment set - see setUserScope. The authoritative
// lists come from user_entities/user_branches.
const USER_SELECT = `
  SELECT u.id, u.email, u.name, u.school_group, u.branch_id, u.role_id, u.is_active,
         u.last_login_at, u.created_at, u.must_change_password,
         u.totp_enabled, u.totp_confirmed_at,
         b.name AS branch_name,
         r.name AS role_name, r.permissions AS role_permissions,
         COALESCE((SELECT json_agg(ue.entity_code ORDER BY ue.entity_code)
                     FROM user_entities ue WHERE ue.user_id = u.id), '[]') AS entity_codes,
         COALESCE((SELECT json_agg(json_build_object(
                             'id', sb.id, 'name', sb.name, 'school_group', sb.school_group)
                           ORDER BY sb.school_group, sb.name)
                     FROM user_branches ub
                     JOIN branches sb ON sb.id = ub.branch_id
                    WHERE ub.user_id = u.id), '[]') AS branch_rows
  FROM users u
  LEFT JOIN branches b ON b.id = u.branch_id
  LEFT JOIN roles r ON r.id = u.role_id
`;

function serializeUser(row) {
  if (!row) return row;
  let permissions = [];
  try {
    permissions = JSON.parse(row.role_permissions || '[]');
  } catch {}
  const { role_permissions, entity_codes, branch_rows, ...rest } = row;
  const branches = branch_rows || [];
  return {
    ...rest,
    role_permissions: permissions,
    // The multi-select scope. `school_group`/`branch_id`/`branch_name` above
    // stay for anything still reading a single value.
    school_groups: entity_codes || [],
    branches,
    branch_ids: branches.map((b) => b.id),
    branch_names: branches.map((b) => b.name),
  };
}

const dedupe = (values) => [...new Set(values)];

// A CSV cell holding one value or a list of them.
//
// Deliberately NOT comma-separated: branch names legitimately contain commas
// ("Pallavi Model School, Alwal"), and the CSV parser hands the quoted cell
// over whole - splitting it again would tear those names in half.
const splitList = (value) =>
  dedupe(
    String(value || '')
      .split(/[;|]/)
      .map((v) => v.trim())
      .filter(Boolean)
  );

// The scope line in the welcome email. Entities are named rather than coded -
// "Delhi Public School (all branches)" reads better than "DPS".
async function describeScope(user) {
  if (user.branches?.length) return user.branches.map((b) => b.name).join(', ');
  if (!user.school_groups?.length) return 'All schools';
  const clause = inList('code', user.school_groups);
  const rows = await db.all(
    `SELECT code, name FROM entities WHERE ${clause.sql}`,
    ...clause.params
  );
  const byCode = Object.fromEntries(rows.map((r) => [r.code, r.name]));
  return `${user.school_groups.map((c) => byCode[c] || c).join(', ')} (all branches)`;
}

// Body fields are accepted in both shapes: the multi-select arrays the admin UI
// now sends, and the single values older callers (and the CSV import) still use.
function requestedGroups(body) {
  if (Array.isArray(body.school_groups)) {
    return dedupe(body.school_groups.map((g) => String(g).trim()).filter(Boolean));
  }
  return body.school_group ? [String(body.school_group).trim()] : [];
}

function requestedBranchIds(body) {
  const raw = Array.isArray(body.branch_ids)
    ? body.branch_ids
    : body.branch_id
      ? [body.branch_id]
      : [];
  return dedupe(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0));
}

// Writes the assignment tables and re-points the legacy columns at the first
// entry of each set. One transaction: a half-applied scope is a half-applied
// permission grant.
async function setUserScope(userId, groups, branchIds) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_entities WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_branches WHERE user_id = $1', [userId]);
    for (const code of groups) {
      await client.query(
        'INSERT INTO user_entities (user_id, entity_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, code]
      );
    }
    for (const id of branchIds) {
      await client.query(
        'INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, id]
      );
    }
    await client.query('UPDATE users SET school_group = $1, branch_id = $2 WHERE id = $3', [
      groups[0] || null,
      branchIds[0] || null,
      userId,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getUser(id) {
  return serializeUser(await db.get(`${USER_SELECT} WHERE u.id = ?`, id));
}

async function getRole(id) {
  const role = await db.get('SELECT * FROM roles WHERE id = ?', id);
  if (!role) return null;
  try {
    role.permissions = JSON.parse(role.permissions || '[]');
  } catch {
    role.permissions = [];
  }
  return role;
}

async function defaultAdminRoleId() {
  return (await db.get("SELECT id FROM roles WHERE name = 'Admin'"))?.id || null;
}

function roleIsUnrestricted(permissions) {
  return permissions.includes('*') || permissions.includes('roles.manage');
}

// A creator may never mint an account more capable than itself. Without this,
// a `users.manage` holder could create a default-Admin user that carries
// permissions the creator lacks, then log in as it.
function exceedsActorPermissions(actor, rolePermissions = []) {
  const actorPerms = actor?.permissions || [];
  if (actorPerms.includes('*')) return null; // super admin
  const extra = rolePermissions.filter((p) => p !== '*' && !actorPerms.includes(p));
  if (rolePermissions.includes('*')) return 'This role grants full access, which you do not have.';
  if (extra.length) {
    return `You cannot grant permissions you do not have: ${extra.join(', ')}.`;
  }
  return null;
}

// Validate a target scope: one or more entities, plus any number of branches
// inside them. No branches means every branch of those entities; branches
// narrow the user to exactly those.
// Returns {error} or {school_groups, branch_ids}.
async function resolveTargetScope(wantGroups = [], wantBranchIds = []) {
  let groups = dedupe(wantGroups.filter(Boolean));
  const ids = dedupe(wantBranchIds);

  let branches = [];
  if (ids.length) {
    const clause = inList('id', ids);
    branches = await db.all(`SELECT * FROM branches WHERE ${clause.sql}`, ...clause.params);
    if (branches.length !== ids.length) {
      return { error: 'One of the selected branches does not exist.' };
    }
    // A branch carries its entity with it, so selecting only branches is enough
    const implied = dedupe(branches.map((b) => b.school_group));
    if (!groups.length) {
      groups = implied;
    } else {
      const stray = implied.filter((code) => !groups.includes(code));
      if (stray.length) {
        return {
          error: `These branches belong to entities that are not selected: ${stray.join(', ')}.`,
        };
      }
    }
  }

  if (groups.length) {
    const clause = inList('code', groups);
    const found = await db.all(
      `SELECT code FROM entities WHERE is_active = 1 AND ${clause.sql}`,
      ...clause.params
    );
    if (found.length !== groups.length) {
      return { error: 'Select valid, active entities.' };
    }
  }

  return { school_groups: groups, branch_ids: branches.map((b) => b.id) };
}

// Can `actor` manage `target`? Only same-or-lesser users inside their scope.
// Applies to every actor, including `roles.manage` holders: listing is already
// narrowed by scope, so mutating outside it would let an admin act on accounts
// they cannot even see.
function canManage(actor, target) {
  if ((actor?.permissions || []).includes('*')) return true; // super admin
  if (roleIsUnrestricted(target.role_permissions || [])) return false;
  const scope = scopeFor(actor);
  const targetBranchIds = target.branch_ids || [];
  const targetGroups = target.school_groups || [];

  // EVERY assignment of the target has to be one the actor holds. A target who
  // reaches even one branch or entity the actor cannot see is not theirs to
  // manage - otherwise a branch admin could edit an account that also covers
  // branches they have no access to.
  if (isBranchScoped(scope)) {
    return (
      targetBranchIds.length > 0 && targetBranchIds.every((id) => scope.branchIds.includes(id))
    );
  }
  if (scope.groups?.length) {
    return targetGroups.length > 0 && targetGroups.every((g) => scope.groups.includes(g));
  }
  return true;
}

// The scope an actor may place a user into. A scoped actor can never reach
// outside its own entity/branch, whatever the request body asks for.
function clampScopeToActor(actor, wantGroups = [], wantBranchIds = []) {
  const scope = scopeFor(actor);

  if (isBranchScoped(scope)) {
    const stray = wantBranchIds.filter((id) => !scope.branchIds.includes(id));
    if (stray.length) {
      return { error: 'You can only assign branches you have access to yourself.' };
    }
    // Nothing chosen means the actor's own branches, never wider
    return {
      groups: scope.groups,
      branchIds: wantBranchIds.length ? wantBranchIds : scope.branchIds,
    };
  }

  if (scope.groups?.length) {
    const stray = wantGroups.filter((g) => !scope.groups.includes(g));
    if (stray.length) {
      return { error: 'You can only manage users within your own entities.' };
    }
    return {
      groups: wantGroups.length ? wantGroups : scope.groups,
      branchIds: wantBranchIds,
    };
  }

  return { groups: wantGroups, branchIds: wantBranchIds };
}

// The last super admin must stay a super admin, and must stay active - losing
// them leaves an instance nobody can administer
async function isLastSuperAdmin(userId) {
  const row = await db.get(
    `SELECT COUNT(*) AS count
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1 AND r.permissions LIKE '%"*"%' AND u.id <> ?`,
    userId
  );
  return row.count === 0;
}

// Which accounts a scoped actor may see. Matched on the assignment tables, so
// a user assigned to several branches shows up under each of them.
function visibleUsersClause(scope) {
  if (isBranchScoped(scope)) {
    const clause = inList('ub.branch_id', scope.branchIds);
    return {
      sql: `WHERE EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id AND ${clause.sql})`,
      params: clause.params,
    };
  }
  if (scope.groups?.length) {
    const clause = inList('ue.entity_code', scope.groups);
    return {
      sql: `WHERE EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ${clause.sql})`,
      params: clause.params,
    };
  }
  return { sql: '', params: [] };
}

exports.list = async (req, res) => {
  const scope = scopeFor(req.user);
  const where = visibleUsersClause(scope);
  const rows = await db.all(`${USER_SELECT} ${where.sql} ORDER BY u.created_at`, ...where.params);

  // roles.manage sees everyone inside its own scope, unrestricted accounts
  // included. Everyone else never sees an account that outranks them.
  const users = rows
    .map(serializeUser)
    .filter((u) => can(req.user, 'roles.manage') || !roleIsUnrestricted(u.role_permissions || []));
  res.json({ users });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const email = (body.email || '').trim();
  const name = (body.name || '').trim();
  // The password is not the creator's to choose: everyone starts on the shared
  // initial password and sets their own the first time they sign in
  const password = INITIAL_PASSWORD;
  const canAssignRoles = can(req.user, 'roles.manage');

  // Role assignment needs roles.manage; everyone else creates default Admin users
  let role_id = await defaultAdminRoleId();
  if (canAssignRoles && body.role_id) {
    const role = await getRole(Number(body.role_id));
    if (!role) return res.status(400).json({ error: 'Selected role does not exist.' });
    if (!role.is_active) {
      return res.status(400).json({ error: 'This role is deactivated and cannot be assigned.' });
    }
    role_id = role.id;
  }
  const role = await getRole(role_id);
  if (!role) return res.status(500).json({ error: 'Default role is missing.' });

  // Privilege ceiling: never create an account that outranks its creator
  const escalation = exceedsActorPermissions(req.user, role.permissions);
  if (escalation) return res.status(403).json({ error: escalation });

  const unrestrictedRole = role.permissions.includes('*');

  let school_groups = [];
  let branch_ids = [];

  if (!unrestrictedRole) {
    // Every creator is clamped to its own scope, roles.manage included -
    // otherwise a scoped role-manager creates users in other entities
    const clamped = clampScopeToActor(req.user, requestedGroups(body), requestedBranchIds(body));
    if (clamped.error) return res.status(403).json({ error: clamped.error });
    const resolved = await resolveTargetScope(clamped.groups, clamped.branchIds);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    school_groups = resolved.school_groups;
    branch_ids = resolved.branch_ids;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', email);
  if (existing) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }

  // The legacy role column stays for backward compatibility with its CHECK constraint
  const legacyRole = unrestrictedRole ? 'super_admin' : 'admin';
  const result = await db.run(
    'INSERT INTO users (email, name, password_hash, role, role_id, school_group, branch_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1) RETURNING id',
    email,
    name,
    bcrypt.hashSync(password, 10),
    legacyRole,
    role_id,
    school_groups[0] || null,
    branch_ids[0] || null
  );
  await setUserScope(result.rows[0].id, school_groups, branch_ids);

  const created = await getUser(result.rows[0].id);

  // Welcome email with credentials - failure never blocks user creation
  const emailSent = await sendWelcomeEmail({
    to: email,
    name,
    password,
    createdBy: `${req.user.name} (${req.user.email})`,
    roleName: role.name,
    permissions: role.permissions,
    scopeText: unrestrictedRole ? 'All schools' : await describeScope(created),
  });

  // The initial password comes back so the creator can pass it on when the
  // welcome email could not be delivered
  res.status(201).json({ user: created, email_sent: emailSent, initial_password: password });
};

// Turn two-factor authentication on or off for one account. Needs
// security.manage AND the target must be inside the actor's scope - turning
// 2FA off destroys the enrolment, so it must not reach accounts you cannot
// otherwise manage.
exports.setTotp = async (req, res) => {
  const id = validId(req.params.id);
  const target = await getUser(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (!canManage(req.user, target)) {
    return res.status(403).json({ error: 'You can only manage users within your scope.' });
  }

  if (req.body === undefined || req.body.enabled === undefined) {
    return res.status(400).json({ error: 'enabled is required.' });
  }
  const enabled = toBool(req.body.enabled) ? 1 : 0;

  if (enabled) {
    // The secret is created at the next sign-in, where the user scans the QR
    await db.run('UPDATE users SET totp_enabled = 1 WHERE id = ?', id);
  } else {
    // Clearing the secret means a later re-enable starts a fresh enrolment,
    // so a lost or compromised phone cannot be reinstated by accident
    await db.run(
      `UPDATE users
       SET totp_enabled = 0, totp_secret = NULL, totp_confirmed_at = NULL, totp_last_step = NULL
       WHERE id = ?`,
      id
    );
  }

  res.json({ user: await getUser(id) });
};

exports.setActive = async (req, res) => {
  const id = validId(req.params.id);
  const target = await getUser(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  if (req.body === undefined || req.body.is_active === undefined) {
    return res.status(400).json({ error: 'is_active is required.' });
  }
  const isActive = toBool(req.body.is_active) ? 1 : 0;

  if (target.id === req.user.id && !isActive) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }
  // Scope is an object-level check - roles.manage must not skip it, or a
  // scoped admin can deactivate accounts (including the super admin) that
  // their own user list does not even show them
  if (!canManage(req.user, target)) {
    return res.status(403).json({ error: 'You can only manage users within your scope.' });
  }
  if (!isActive && roleIsUnrestricted(target.role_permissions || []) && (await isLastSuperAdmin(target.id))) {
    return res.status(400).json({
      error: 'This is the only super admin. Activate another one before deactivating this account.',
    });
  }

  await db.run('UPDATE users SET is_active = ? WHERE id = ?', isActive, id);
  res.json({ user: await getUser(id) });
};

// roles.manage only: change role, scope, name, or reset password
exports.update = async (req, res) => {
  const id = validId(req.params.id);
  const target = await getUser(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  // Editing is an object-level action: holding roles.manage says nothing about
  // whether THIS user is yours to touch
  if (!canManage(req.user, target)) {
    return res.status(403).json({ error: 'You can only manage users within your scope.' });
  }

  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : target.name;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (name.length > 120) {
    return res.status(400).json({ error: 'Name is too long (maximum 120 characters).' });
  }

  // The address is the account's identity and where password resets and export
  // approval codes are sent, so a wrong one leaves the account unrecoverable.
  // Changing it is deliberately restricted to a super admin.
  let email = target.email;
  if (body.email !== undefined && String(body.email).trim().toLowerCase() !== target.email.toLowerCase()) {
    if (!(req.user?.permissions || []).includes('*')) {
      return res.status(403).json({ error: 'Only a super admin can change a sign-in email.' });
    }
    email = String(body.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    const clash = await db.get(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?',
      email,
      id
    );
    if (clash) return res.status(409).json({ error: 'Another user already has this email.' });
  }

  let role_id = target.role_id;
  if (body.role_id !== undefined) {
    const role = await getRole(Number(body.role_id));
    if (!role) return res.status(400).json({ error: 'Selected role does not exist.' });
    if (!role.is_active && role.id !== target.role_id) {
      return res.status(400).json({ error: 'This role is deactivated and cannot be assigned.' });
    }
    role_id = role.id;
  }
  const role = await getRole(role_id);
  const unrestrictedRole = role ? role.permissions.includes('*') : false;

  // The same privilege ceiling `create` applies. Without it, a roles.manage
  // holder assigns itself the Super Admin role and owns the instance.
  const escalation = exceedsActorPermissions(req.user, role?.permissions || []);
  if (escalation) return res.status(403).json({ error: escalation });

  if (target.id === req.user.id && !role?.permissions.includes('roles.manage') && !unrestrictedRole) {
    return res.status(400).json({ error: 'You cannot remove role management from your own account.' });
  }
  // Demoting the only super admin leaves nobody who can administer the portal
  if (
    roleIsUnrestricted(target.role_permissions || []) &&
    !unrestrictedRole &&
    (await isLastSuperAdmin(target.id))
  ) {
    return res.status(400).json({
      error: 'This is the only super admin. Promote another account before changing this one.',
    });
  }

  // An omitted field keeps what the account already has; an empty array clears it
  const scopeTouched = body.school_groups !== undefined || body.school_group !== undefined ||
    body.branch_ids !== undefined || body.branch_id !== undefined;
  let school_groups = [];
  let branch_ids = [];
  if (!unrestrictedRole) {
    const clamped = clampScopeToActor(
      req.user,
      scopeTouched ? requestedGroups(body) : target.school_groups,
      scopeTouched ? requestedBranchIds(body) : target.branch_ids
    );
    if (clamped.error) return res.status(403).json({ error: clamped.error });
    const resolved = await resolveTargetScope(clamped.groups, clamped.branchIds);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    school_groups = resolved.school_groups;
    branch_ids = resolved.branch_ids;
  }

  const legacyRole = unrestrictedRole ? 'super_admin' : 'admin';
  await db.run(
    'UPDATE users SET name = ?, email = ?, role = ?, role_id = ? WHERE id = ?',
    name,
    email,
    legacyRole,
    role_id,
    id
  );
  // Also re-points users.school_group / users.branch_id, so an unrestricted
  // role clears the scope rather than leaving a stale one behind
  await setUserScope(id, school_groups, branch_ids);

  // An admin-initiated reset hands out the temporary password: stamping the
  // change invalidates sessions opened with the old one, and the flag forces
  // the owner to pick their own password before they can use the portal again.
  // The actor cannot choose the value - one less way to plant a known password.
  if (body.reset_password) {
    await db.run(
      `UPDATE users
       SET password_hash = ?, password_changed_at = now(), must_change_password = 1
       WHERE id = ?`,
      bcrypt.hashSync(INITIAL_PASSWORD, 10),
      id
    );
    return res.json({ user: await getUser(id), initial_password: INITIAL_PASSWORD });
  }

  res.json({ user: await getUser(id) });
};

// ---- CSV import ------------------------------------------------------------
// Email is the identifier: existing addresses are skipped, never overwritten.
// Imported accounts get the same initial password as ones created by hand.

exports.importCsv = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a CSV file to import.' });

  const { rows, headers, error } = parseCsvFile(req.file.buffer);
  if (error) return res.status(400).json({ error });
  if (!rows.length) return res.status(400).json({ error: 'The file has no data rows.' });
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows - the limit is ${MAX_ROWS}.` });
  }
  const headerError = checkHeaders(headers, HEADER_RULES.users);
  if (headerError) return res.status(400).json({ error: headerError });

  const canAssignRoles = can(req.user, 'roles.manage');
  const results = { imported: 0, skipped: 0, failed: 0, errors: [], created: [] };
  const seen = new Set();

  for (const row of rows) {
    const email = pick(row, 'email', 'email_id', 'e_mail', 'e_mail_id', 'mail', 'mail_id').toLowerCase();
    const name = pick(row, 'name', 'full_name', 'user_name');
    const roleName = pick(row, 'role', 'role_name');
    // Both columns take a comma-separated list, so one row can assign several
    // entities or branches exactly as the create form now does
    const entityCodes = splitList(pick(row, 'entity', 'school_group', 'group', 'entity_code'));
    const branchNames = splitList(pick(row, 'branch', 'branch_name'));

    const fail = (reason) => {
      results.failed += 1;
      results.errors.push({ row: row.__row, value: email || name || '(blank)', reason });
    };

    if (!email && !name) continue; // blank line
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail('A valid email address is required.');
      continue;
    }
    if (!name) {
      fail('Name is required.');
      continue;
    }
    if (seen.has(email)) {
      results.skipped += 1;
      continue;
    }
    seen.add(email);

    if (await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', email)) {
      results.skipped += 1;
      continue;
    }

    // Role: only assignable with roles.manage. A named role is never silently
    // downgraded to Admin - that could hand out more access than intended.
    let role_id = await defaultAdminRoleId();
    if (roleName && !canAssignRoles) {
      fail('You cannot assign roles. Remove the "role" column to import these as Admin users.');
      continue;
    }
    if (roleName && canAssignRoles) {
      const found = await db.get('SELECT * FROM roles WHERE LOWER(name) = LOWER(?)', roleName);
      if (!found) {
        fail(`Role "${roleName}" does not exist.`);
        continue;
      }
      if (!found.is_active) {
        fail(`Role "${roleName}" is deactivated.`);
        continue;
      }
      role_id = found.id;
    }
    const role = await getRole(role_id);
    if (!role) {
      fail('Default role is missing.');
      continue;
    }
    // The same privilege ceiling as creating a user by hand: a bulk upload must
    // not be a way around it
    const escalation = exceedsActorPermissions(req.user, role.permissions);
    if (escalation) {
      fail(escalation);
      continue;
    }
    const unrestrictedRole = role.permissions.includes('*');

    // Scope: importers without roles.manage can only create inside their own
    let school_groups = [];
    let branch_ids = [];
    if (!unrestrictedRole) {
      const wantGroups = [...entityCodes];
      const wantBranchIds = [];
      let branchLookupFailed = null;

      for (const branchName of branchNames) {
        // Two entities may legitimately share a branch name, so the entity
        // column must narrow the lookup when it is supplied. With several
        // entities named, the branch has to resolve inside exactly one of them.
        const matches = entityCodes.length
          ? await db.all(
              `SELECT * FROM branches
                WHERE LOWER(name) = LOWER(?) AND is_active = 1
                  AND ${inList('school_group', entityCodes).sql}
                ORDER BY id`,
              branchName,
              ...inList('school_group', entityCodes).params
            )
          : await db.all(
              'SELECT * FROM branches WHERE LOWER(name) = LOWER(?) AND is_active = 1 ORDER BY id',
              branchName
            );
        if (!matches.length) {
          branchLookupFailed = entityCodes.length
            ? `Branch "${branchName}" not found or inactive for entity "${entityCodes.join(', ')}".`
            : `Branch "${branchName}" not found or inactive.`;
          break;
        }
        if (matches.length > 1) {
          branchLookupFailed = `Branch "${branchName}" exists in more than one entity - name the entity in the "entity" column.`;
          break;
        }
        wantBranchIds.push(matches[0].id);
        if (!wantGroups.includes(matches[0].school_group)) wantGroups.push(matches[0].school_group);
      }
      if (branchLookupFailed) {
        fail(branchLookupFailed);
        continue;
      }

      // Clamped for every importer, roles.manage included
      const clamped = clampScopeToActor(req.user, wantGroups, wantBranchIds);
      if (clamped.error) {
        fail(clamped.error);
        continue;
      }

      const resolved = await resolveTargetScope(clamped.groups, clamped.branchIds);
      if (resolved.error) {
        fail(resolved.error);
        continue;
      }
      school_groups = resolved.school_groups;
      branch_ids = resolved.branch_ids;
    }

    const password = INITIAL_PASSWORD;
    const legacyRole = unrestrictedRole ? 'super_admin' : 'admin';
    const result = await db.run(
      'INSERT INTO users (email, name, password_hash, role, role_id, school_group, branch_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1) RETURNING id',
      email,
      name,
      bcrypt.hashSync(password, 10),
      legacyRole,
      role_id,
      school_groups[0] || null,
      branch_ids[0] || null
    );
    await setUserScope(result.rows[0].id, school_groups, branch_ids);

    const created = await getUser(result.rows[0].id);
    results.imported += 1;

    // Credentials go out by email; without SMTP they come back in the response
    // so the importer can hand them over
    let emailed = false;
    if (mailConfigured()) {
      emailed = await sendWelcomeEmail({
        to: email,
        name,
        password,
        createdBy: req.user.name,
        roleName: role.name,
        permissions: role.permissions,
        scopeText: unrestrictedRole ? 'All schools' : await describeScope(created),
      });
    }
    results.created.push({ email, name, emailed, password: emailed ? undefined : password });
  }

  res.json(results);
};
