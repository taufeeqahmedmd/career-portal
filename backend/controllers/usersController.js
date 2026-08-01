const bcrypt = require('bcryptjs');
const db = require('../db');
const { scopeFor } = require('../utils/scope');
const { can } = require('../utils/permissions');
const { sendWelcomeEmail, isConfigured: mailConfigured } = require('../utils/mailer');
const { parseCsvFile, pick, MAX_ROWS, checkHeaders, HEADER_RULES } = require('../utils/csvImport');
const { validId, toBool, str } = require('../utils/validate');

// Every account is created on this password and cannot use the portal until it
// has been replaced - see requirePasswordChanged in middlewares/auth.js
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '12345678';

const USER_SELECT = `
  SELECT u.id, u.email, u.name, u.school_group, u.branch_id, u.role_id, u.is_active,
         u.last_login_at, u.created_at, u.must_change_password,
         u.totp_enabled, u.totp_confirmed_at,
         b.name AS branch_name,
         r.name AS role_name, r.permissions AS role_permissions
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
  const { role_permissions, ...rest } = row;
  return { ...rest, role_permissions: permissions };
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

// Validate a target scope (group + optional branch). Returns {error} or {school_group, branch_id}
async function resolveTargetScope(school_group, branch_id) {
  if (branch_id) {
    const branch = await db.get('SELECT * FROM branches WHERE id = ?', branch_id);
    if (!branch) return { error: 'Selected branch does not exist.' };
    if (school_group && school_group !== branch.school_group) {
      return { error: 'Branch does not belong to the selected school group.' };
    }
    return { school_group: branch.school_group, branch_id: branch.id };
  }
  if (school_group) {
    const entity = await db.get(
      'SELECT code FROM entities WHERE code = ? AND is_active = 1',
      school_group
    );
    if (!entity) return { error: 'Select a valid, active entity.' };
  }
  return { school_group: school_group || null, branch_id: null };
}

// Can `actor` manage `target`? Only same-or-lesser users inside their scope.
// Applies to every actor, including `roles.manage` holders: listing is already
// narrowed by scope, so mutating outside it would let an admin act on accounts
// they cannot even see.
function canManage(actor, target) {
  if ((actor?.permissions || []).includes('*')) return true; // super admin
  if (roleIsUnrestricted(target.role_permissions || [])) return false;
  const scope = scopeFor(actor);
  if (scope.branchId) return target.branch_id === scope.branchId;
  if (scope.group) return target.school_group === scope.group;
  return true;
}

// The scope an actor may place a user into. A scoped actor can never reach
// outside its own entity/branch, whatever the request body asks for.
function clampScopeToActor(actor, wantGroup, wantBranchId) {
  const scope = scopeFor(actor);
  if (scope.branchId) return { group: scope.group, branchId: scope.branchId };
  if (scope.group) {
    if (wantGroup && wantGroup !== scope.group) {
      return { error: 'You can only manage users within your own entity.' };
    }
    return { group: scope.group, branchId: wantBranchId || null };
  }
  return { group: wantGroup || null, branchId: wantBranchId || null };
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

exports.list = async (req, res) => {
  const scope = scopeFor(req.user);
  // roles.manage sees everyone, but an assigned entity/branch still narrows the
  // view - otherwise a scoped role-manager could list other entities' users
  if (can(req.user, 'roles.manage') && !scope.group && !scope.branchId) {
    const users = (await db.all(`${USER_SELECT} ORDER BY u.created_at`)).map(serializeUser);
    return res.json({ users });
  }

  if (can(req.user, 'roles.manage')) {
    const rows = scope.branchId
      ? await db.all(`${USER_SELECT} WHERE u.branch_id = ? ORDER BY u.created_at`, scope.branchId)
      : await db.all(`${USER_SELECT} WHERE u.school_group = ? ORDER BY u.created_at`, scope.group);
    return res.json({ users: rows.map(serializeUser) });
  }

  let rows;
  if (scope.branchId) {
    rows = await db.all(`${USER_SELECT} WHERE u.branch_id = ? ORDER BY u.created_at`, scope.branchId);
  } else if (scope.group) {
    rows = await db.all(
      `${USER_SELECT} WHERE u.school_group = ? ORDER BY u.created_at`,
      scope.group
    );
  } else {
    rows = await db.all(`${USER_SELECT} ORDER BY u.created_at`);
  }
  // Hide unrestricted accounts from scoped managers
  const users = rows
    .map(serializeUser)
    .filter((u) => !roleIsUnrestricted(u.role_permissions || []));
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

  let school_group = null;
  let branch_id = null;

  if (!unrestrictedRole) {
    // Every creator is clamped to its own scope, roles.manage included -
    // otherwise a scoped role-manager creates users in other entities
    const clamped = clampScopeToActor(req.user, body.school_group || null, body.branch_id || null);
    if (clamped.error) return res.status(403).json({ error: clamped.error });
    const resolved = await resolveTargetScope(clamped.group, clamped.branchId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    school_group = resolved.school_group;
    branch_id = resolved.branch_id;
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
    school_group,
    branch_id
  );

  const created = await getUser(result.rows[0].id);

  // Welcome email with credentials - failure never blocks user creation
  const entityName = school_group
    ? (await db.get('SELECT name FROM entities WHERE code = ?', school_group))?.name || school_group
    : null;
  const scopeText = unrestrictedRole
    ? 'All schools'
    : created.branch_name
      ? created.branch_name
      : entityName
        ? `${entityName} (all branches)`
        : 'All schools';

  const emailSent = await sendWelcomeEmail({
    to: email,
    name,
    password,
    createdBy: `${req.user.name} (${req.user.email})`,
    roleName: role.name,
    permissions: role.permissions,
    scopeText,
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

  let school_group = null;
  let branch_id = null;
  if (!unrestrictedRole) {
    const clamped = clampScopeToActor(
      req.user,
      body.school_group !== undefined ? body.school_group || null : target.school_group,
      body.branch_id !== undefined ? body.branch_id || null : target.branch_id
    );
    if (clamped.error) return res.status(403).json({ error: clamped.error });
    const resolved = await resolveTargetScope(clamped.group, clamped.branchId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    school_group = resolved.school_group;
    branch_id = resolved.branch_id;
  }

  const legacyRole = unrestrictedRole ? 'super_admin' : 'admin';
  await db.run(
    'UPDATE users SET name = ?, email = ?, role = ?, role_id = ?, school_group = ?, branch_id = ? WHERE id = ?',
    name,
    email,
    legacyRole,
    role_id,
    school_group,
    branch_id,
    id
  );

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
    const entityCode = pick(row, 'entity', 'school_group', 'group', 'entity_code');
    const branchName = pick(row, 'branch', 'branch_name');

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
    let school_group = null;
    let branch_id = null;
    if (!unrestrictedRole) {
      let wantGroup = entityCode || null;
      let wantBranchId = null;

      if (branchName) {
        // Two entities may legitimately share a branch name, so the entity
        // column must narrow the lookup when it is supplied
        const branch = entityCode
          ? await db.get(
              'SELECT * FROM branches WHERE LOWER(name) = LOWER(?) AND school_group = ? AND is_active = 1',
              branchName,
              entityCode
            )
          : await db.get(
              'SELECT * FROM branches WHERE LOWER(name) = LOWER(?) AND is_active = 1 ORDER BY id LIMIT 1',
              branchName
            );
        if (!branch) {
          fail(
            entityCode
              ? `Branch "${branchName}" not found or inactive for entity "${entityCode}".`
              : `Branch "${branchName}" not found or inactive.`
          );
          continue;
        }
        wantBranchId = branch.id;
        wantGroup = wantGroup || branch.school_group;
      }

      // Clamped for every importer, roles.manage included
      const clamped = clampScopeToActor(req.user, wantGroup, wantBranchId);
      if (clamped.error) {
        fail(clamped.error);
        continue;
      }

      const resolved = await resolveTargetScope(clamped.group, clamped.branchId);
      if (resolved.error) {
        fail(resolved.error);
        continue;
      }
      school_group = resolved.school_group;
      branch_id = resolved.branch_id;
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
      school_group,
      branch_id
    );

    const created = await getUser(result.rows[0].id);
    results.imported += 1;

    // Credentials go out by email; without SMTP they come back in the response
    // so the importer can hand them over
    let emailed = false;
    if (mailConfigured()) {
      const entityName = school_group
        ? (await db.get('SELECT name FROM entities WHERE code = ?', school_group))?.name ||
          school_group
        : null;
      emailed = await sendWelcomeEmail({
        to: email,
        name,
        password,
        createdBy: req.user.name,
        roleName: role.name,
        permissions: role.permissions,
        scopeText: unrestrictedRole
          ? 'All schools'
          : created.branch_name || (entityName ? `${entityName} (all branches)` : 'All schools'),
      });
    }
    results.created.push({ email, name, emailed, password: emailed ? undefined : password });
  }

  res.json(results);
};
