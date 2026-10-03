// Permissions and scoping. These are object-level checks: holding a permission
// says what kind of action you may take, never which records you may take it
// on. Every case here was a real escalation path at some point.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer,
  stopServer,
  request,
  login,
  rootToken,
  createUserAndSignIn,
  createRole,
  submitApplication,
} = require('./helpers');

test.before(startServer);
test.after(stopServer);

test('a roles.manage holder cannot promote itself to super admin', async () => {
  const root = await rootToken();
  const roleId = await createRole(root, 'Role Manager', ['roles.manage']);
  const actor = await createUserAndSignIn(root, {
    name: 'Role Manager',
    email: 'rolemgr@test.local',
    roleId,
  });

  const roles = (await request('/admin/roles', { token: root })).body.roles;
  const superRoleId = roles.find((r) => r.permissions.includes('*')).id;

  const promote = await request(`/admin/users/${actor.id}`, {
    method: 'PUT',
    token: actor.token,
    body: { role_id: superRoleId },
  });
  assert.equal(promote.status, 403);

  const me = await request('/admin/me', { token: actor.token });
  assert.ok(!me.body.user.permissions.includes('*'), 'must not have gained full access');
});

test('a roles.manage holder cannot reset the super admin password', async () => {
  const root = await rootToken();
  const roleId = await createRole(root, 'Role Manager 2', ['roles.manage', 'users.manage']);
  const actor = await createUserAndSignIn(root, {
    name: 'Role Manager 2',
    email: 'rolemgr2@test.local',
    roleId,
  });

  const users = (await request('/admin/users', { token: root })).body.users;
  const superAdmin = users.find((u) => (u.role_permissions || []).includes('*'));

  const reset = await request(`/admin/users/${superAdmin.id}`, {
    method: 'PUT',
    token: actor.token,
    body: { reset_password: true },
  });
  assert.equal(reset.status, 403);
  // The super admin's password must be unchanged
  assert.equal((await login(superAdmin.email, '12345678')).status, 401);
});

test('a role cannot be given permissions its author does not hold', async () => {
  const root = await rootToken();
  const roleId = await createRole(root, 'Limited Manager', ['roles.manage']);
  const actor = await createUserAndSignIn(root, {
    name: 'Limited',
    email: 'limited@test.local',
    roleId,
  });

  // Editing your own role is the shortest path to self-escalation
  const own = await request(`/admin/roles/${roleId}`, {
    method: 'PUT',
    token: actor.token,
    body: { permissions: ['roles.manage', 'security.manage', 'applications.export'] },
  });
  assert.equal(own.status, 403);

  // Nor a new role carrying more than the author has
  const created = await request('/admin/roles', {
    method: 'POST',
    token: actor.token,
    body: { name: 'Sneaky', description: '', permissions: ['security.manage'] },
  });
  assert.equal(created.status, 403);

  // Nor a system role, which would re-permission everyone holding it
  const roles = (await request('/admin/roles', { token: root })).body.roles;
  const adminRole = roles.find((r) => r.name === 'Admin');
  const systemEdit = await request(`/admin/roles/${adminRole.id}`, {
    method: 'PUT',
    token: actor.token,
    body: { permissions: ['applications.view', 'security.manage'] },
  });
  assert.equal(systemEdit.status, 403);
});

test('an instance can never be left without a super admin', async () => {
  const root = await rootToken();
  const roles = (await request('/admin/roles', { token: root })).body.roles;
  const adminRole = roles.find((r) => r.name === 'Admin');
  const superRole = roles.find((r) => r.permissions.includes('*'));
  const superAdmin = (await request('/admin/users', { token: root })).body.users.find((u) =>
    (u.role_permissions || []).includes('*')
  );

  // Demoting the only one is refused. Several guards can catch this; what
  // matters is that it is refused and the account keeps its access.
  const demote = await request(`/admin/users/${superAdmin.id}`, {
    method: 'PUT',
    token: root,
    body: { role_id: adminRole.id },
  });
  assert.equal(demote.status, 400);
  const stillSuper = (await request('/admin/me', { token: root })).body.user;
  assert.ok(stillSuper.permissions.includes('*'), 'must still be a super admin');

  // Deactivating the only one is refused too
  const deactivate = await request(`/admin/users/${superAdmin.id}`, {
    method: 'PATCH',
    token: root,
    body: { is_active: false },
  });
  assert.equal(deactivate.status, 400);

  // With a second super admin in place, the first may be demoted
  const second = await createUserAndSignIn(root, {
    name: 'Second Super',
    email: 'second.super@test.local',
    roleId: superRole.id,
  });
  const now = await request(`/admin/users/${superAdmin.id}`, {
    method: 'PUT',
    token: second.token,
    body: { role_id: adminRole.id },
  });
  assert.equal(now.status, 200, 'the guard must not block a genuine handover');
  assert.ok(!now.body.user.role_permissions.includes('*'));

  // Restore it: the tests share one server, so leaving the root account
  // demoted would break every case after this one
  const restored = await request(`/admin/users/${superAdmin.id}`, {
    method: 'PUT',
    token: second.token,
    body: { role_id: superRole.id },
  });
  assert.equal(restored.status, 200);
});

test('scoped admins cannot reach another entity or branch', async () => {
  const root = await rootToken();
  const branches = (await request('/admin/branches', { token: root })).body.branches;
  const roles = (await request('/admin/roles', { token: root })).body.roles;
  const adminRole = roles.find((r) => r.name === 'Admin');
  const mine = branches[0];
  const theirs = branches.find((b) => b.id !== mine.id);

  const scoped = await createUserAndSignIn(root, {
    name: 'Branch Admin',
    email: 'branchadmin@test.local',
    roleId: adminRole.id,
    school_group: mine.school_group,
    branch_id: mine.id,
  });

  const openings = (await request('/openings')).body.openings;
  const mineOpening = openings.find((o) => o.branch === mine.name);
  const theirsOpening = openings.find((o) => o.branch === theirs.name);
  assert.ok(mineOpening && theirsOpening, 'need one opening in each branch');

  await submitApplication({ name: 'In Scope', mobile: '9800000001', openingId: mineOpening.id });
  await submitApplication({ name: 'Out Of Scope', mobile: '9800000002', openingId: theirsOpening.id });

  const listed = (await request('/admin/applications', { token: scoped.token })).body.applications;
  assert.ok(listed.length > 0);
  assert.ok(
    listed.every((a) => a.branch === mine.name),
    'the list must not include another branch'
  );

  const all = (await request('/admin/applications', { token: root })).body.applications;
  const foreign = all.find((a) => a.branch === theirs.name);

  // Every route that takes an application id must re-check ownership
  for (const [method, path, body] of [
    ['GET', `/admin/applications/${foreign.id}`, undefined],
    ['GET', `/admin/applications/${foreign.id}/resume`, undefined],
    ['PUT', `/admin/applications/${foreign.id}/screening`, { status: 'hold' }],
    ['PUT', `/admin/applications/${foreign.id}/rounds/1`, { feedback: 'x', status: 'hold' }],
    ['PUT', `/admin/applications/${foreign.id}/suggestion`, { suggested_role: '' }],
  ]) {
    const res = await request(path, { method, token: scoped.token, body });
    assert.equal(res.status, 404, `${method} ${path} should 404 out of scope`);
  }

  // A filter parameter must not widen the scope
  const attempt = await request(
    `/admin/applications?school_group=${encodeURIComponent(theirs.school_group)}`,
    { token: scoped.token }
  );
  assert.ok(
    attempt.body.applications.every((a) => a.branch === mine.name),
    'a query parameter must not override scope'
  );
});

test('viewing applications does not permit changing them', async () => {
  const root = await rootToken();
  const roleId = await createRole(root, 'Read Only', ['applications.view']);
  const viewer = await createUserAndSignIn(root, {
    name: 'Viewer',
    email: 'viewer@test.local',
    roleId,
  });

  const all = (await request('/admin/applications', { token: root })).body.applications;
  assert.ok(all.length > 0);

  assert.equal((await request('/admin/applications', { token: viewer.token })).status, 200);
  const write = await request(`/admin/applications/${all[0].id}/screening`, {
    method: 'PUT',
    token: viewer.token,
    body: { status: 'not_selected', comments: 'viewer should not be able to write this' },
  });
  assert.equal(write.status, 403);
});

test('bulk import is a separate grant from managing the records', async () => {
  const root = await rootToken();
  const withoutImport = await createRole(root, 'No Import', [
    'users.manage',
    'openings.view',
    'openings.manage',
    'flow.manage',
  ]);
  const actor = await createUserAndSignIn(root, {
    name: 'No Import',
    email: 'noimport@test.local',
    roleId: withoutImport,
  });

  const csv = new FormData();
  csv.append('file', new Blob([Buffer.from('name,email\nA,a@b.com\n')], { type: 'text/csv' }), 'u.csv');
  for (const path of ['/admin/users/import', '/admin/openings/import', '/admin/flow-options/import']) {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('name,email\nA,a@b.com\n')], { type: 'text/csv' }), 'u.csv');
    const res = await request(path, { method: 'POST', token: actor.token, body: form });
    assert.equal(res.status, 403, `${path} needs data.import`);
  }
});

test('security settings need security.manage and stay inside scope', async () => {
  const root = await rootToken();
  const roleId = await createRole(root, 'Plain Admin', ['applications.view']);
  const actor = await createUserAndSignIn(root, {
    name: 'Plain',
    email: 'plain@test.local',
    roleId,
  });

  assert.equal((await request('/admin/security', { token: actor.token })).status, 403);
  assert.equal(
    (await request('/admin/security', { method: 'PUT', token: actor.token, body: { require_totp: false } })).status,
    403
  );
  const users = (await request('/admin/users', { token: root })).body.users;
  const superAdmin = users.find((u) => (u.role_permissions || []).includes('*'));
  const res = await request(`/admin/users/${superAdmin.id}/totp`, {
    method: 'PATCH',
    token: actor.token,
    body: { enabled: false },
  });
  assert.equal(res.status, 403);
});

test('ids that are not ids do not produce a 500', async () => {
  const root = await rootToken();
  const paths = ['/admin/users/', '/admin/roles/', '/admin/branches/', '/admin/applications/'];
  for (const base of paths) {
    for (const id of ['abc', '0', '-1', '1.5', '99999999']) {
      const res = await request(`${base}${id}`, { token: root });
      assert.ok(res.status < 500, `GET ${base}${id} returned ${res.status}`);
    }
  }
});

// ---- Multi-entity / multi-branch assignment --------------------------------
// A user holds a set of entities and, inside them, a set of branches. No
// branches means every branch of those entities; branches narrow to exactly
// those. Each case below is a way that set could be widened by accident.

test('a user assigned two branches sees both and nothing else', async () => {
  const root = await rootToken();
  const branches = (await request('/admin/branches', { token: root })).body.branches;
  const roles = (await request('/admin/roles', { token: root })).body.roles;
  const adminRole = roles.find((r) => r.name === 'Admin');

  const [first, second] = branches;
  const outsider = branches.find((b) => b.id !== first.id && b.id !== second.id);
  assert.ok(outsider, 'need a third branch to prove the boundary');

  const scoped = await createUserAndSignIn(root, {
    name: 'Two Branch Admin',
    email: 'twobranch@test.local',
    roleId: adminRole.id,
    school_groups: [...new Set([first.school_group, second.school_group])],
    branch_ids: [first.id, second.id],
  });

  const me = (await request('/admin/me', { token: scoped.token })).body.user;
  assert.deepEqual(
    [...me.branch_ids].sort((a, b) => a - b),
    [first.id, second.id].sort((a, b) => a - b),
    'both branches must come back on the session'
  );

  // The branch list is the user's own two, never the whole instance
  const visible = (await request('/admin/branches', { token: scoped.token })).body.branches;
  assert.deepEqual(
    visible.map((b) => b.id).sort((a, b) => a - b),
    [first.id, second.id].sort((a, b) => a - b)
  );

  // Applications: both branches are in, the third is out
  const openings = (await request('/openings')).body.openings;
  const inA = openings.find((o) => o.branch === first.name);
  const inB = openings.find((o) => o.branch === second.name);
  const out = openings.find((o) => o.branch === outsider.name);
  assert.ok(inA && inB && out, 'need an opening in each of the three branches');

  await submitApplication({ name: 'Multi A', mobile: '9700000001', openingId: inA.id });
  await submitApplication({ name: 'Multi B', mobile: '9700000002', openingId: inB.id });
  await submitApplication({ name: 'Multi Out', mobile: '9700000003', openingId: out.id });

  const listed = (await request('/admin/applications', { token: scoped.token })).body.applications;
  const names = listed.map((a) => a.branch);
  assert.ok(names.includes(first.name) && names.includes(second.name), 'both branches must show');
  assert.ok(
    listed.every((a) => a.branch !== outsider.name),
    'a branch that was not assigned must stay out'
  );
});

test('an entity assignment covers every branch of that entity', async () => {
  const root = await rootToken();
  const branches = (await request('/admin/branches', { token: root })).body.branches;
  const roles = (await request('/admin/roles', { token: root })).body.roles;
  const adminRole = roles.find((r) => r.name === 'Admin');

  const group = branches[0].school_group;
  const inGroup = branches.filter((b) => b.school_group === group);
  assert.ok(inGroup.length > 1, 'need an entity with several branches');

  const scoped = await createUserAndSignIn(root, {
    name: 'Whole Entity Admin',
    email: 'wholeentity@test.local',
    roleId: adminRole.id,
    school_groups: [group],
    branch_ids: [],
  });

  const visible = (await request('/admin/branches', { token: scoped.token })).body.branches;
  assert.equal(
    visible.length,
    inGroup.length,
    'no branch selection means every branch of the entity'
  );
  assert.ok(visible.every((b) => b.school_group === group));
});

test('a scoped admin cannot hand out a branch it does not hold', async () => {
  const root = await rootToken();
  const branches = (await request('/admin/branches', { token: root })).body.branches;
  const roles = (await request('/admin/roles', { token: root })).body.roles;
  // The actor carries the same role it hands out - the privilege ceiling is a
  // separate rule, and this case is about scope alone
  const adminRole = roles.find((r) => r.name === 'Admin');
  const mine = branches[0];
  const theirs = branches.find((b) => b.id !== mine.id);

  const actor = await createUserAndSignIn(root, {
    name: 'Scoped Manager',
    email: 'scopedmgr@test.local',
    roleId: adminRole.id,
    school_groups: [mine.school_group],
    branch_ids: [mine.id],
  });

  // Naming someone else's branch is refused outright, not silently dropped
  const reach = await request('/admin/users', {
    method: 'POST',
    token: actor.token,
    body: {
      name: 'Smuggled',
      email: 'smuggled@test.local',
      branch_ids: [mine.id, theirs.id],
    },
  });
  assert.equal(reach.status, 403, 'must not assign a branch the creator does not hold');

  // Asking for nothing gets the creator's own scope, never everything
  const created = await request('/admin/users', {
    method: 'POST',
    token: actor.token,
    body: { name: 'Inherited', email: 'inherited@test.local' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.user.branch_ids, [mine.id], 'blank scope must not widen');
});

test('branches must belong to the entities they are assigned with', async () => {
  const root = await rootToken();
  const entities = (await request('/admin/entities', { token: root })).body.entities;
  const branches = (await request('/admin/branches', { token: root })).body.branches;
  const roles = (await request('/admin/roles', { token: root })).body.roles;
  const adminRole = roles.find((r) => r.name === 'Admin');

  const branch = branches[0];
  const otherEntity = entities.find((e) => e.is_active && e.code !== branch.school_group);
  assert.ok(otherEntity, 'need a second active entity');

  const res = await request('/admin/users', {
    method: 'POST',
    token: root,
    body: {
      name: 'Mismatched',
      email: 'mismatched@test.local',
      role_id: adminRole.id,
      school_groups: [otherEntity.code],
      branch_ids: [branch.id],
    },
  });
  assert.equal(res.status, 400, 'a branch outside the selected entities is rejected');
  assert.match(res.body.error, /not selected/);
});

test('editing a scope replaces it rather than adding to it', async () => {
  const root = await rootToken();
  const branches = (await request('/admin/branches', { token: root })).body.branches;
  const roles = (await request('/admin/roles', { token: root })).body.roles;
  const adminRole = roles.find((r) => r.name === 'Admin');
  const [first, second] = branches;

  const created = await request('/admin/users', {
    method: 'POST',
    token: root,
    body: {
      name: 'Rescoped',
      email: 'rescoped@test.local',
      role_id: adminRole.id,
      school_groups: [...new Set([first.school_group, second.school_group])],
      branch_ids: [first.id, second.id],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.branch_ids.length, 2);

  const narrowed = await request(`/admin/users/${created.body.user.id}`, {
    method: 'PUT',
    token: root,
    body: { school_groups: [second.school_group], branch_ids: [second.id] },
  });
  assert.equal(narrowed.status, 200);
  assert.deepEqual(narrowed.body.user.branch_ids, [second.id], 'the old branch must be gone');
  assert.deepEqual(narrowed.body.user.school_groups, [second.school_group]);
});
