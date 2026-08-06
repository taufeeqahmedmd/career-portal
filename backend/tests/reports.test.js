// The instance report: what it counts, and that a scoped admin only ever sees
// their own slice of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer,
  stopServer,
  request,
  rootToken,
  createRole,
  createUserAndSignIn,
  submitApplication,
} = require('./helpers');

test.before(startServer);
test.after(stopServer);

const report = (token, days) =>
  request(`/admin/reports${days ? `?days=${days}` : ''}`, { token });

test('the report needs its own permission', async () => {
  const root = await rootToken();
  const roleId = await createRole(root, 'Intake Viewer', ['applications.view']);
  const viewer = await createUserAndSignIn(root, {
    name: 'Intake Viewer',
    email: 'reportless@test.local',
    roleId,
  });

  // Seeing applications is not the same as seeing the whole instance
  assert.equal((await report(viewer.token)).status, 403);
  assert.equal((await request('/admin/reports/export', { token: viewer.token })).status, 403);
  assert.equal((await report(root)).status, 200);
});

test('an unrestricted report counts the whole instance', async () => {
  const root = await rootToken();
  const openings = (await request('/openings')).body.openings;
  await submitApplication({ name: 'Report One', mobile: '9700000001', openingId: openings[0].id });
  await submitApplication({ name: 'Report Two', mobile: '9700000002', openingId: openings[1].id });

  const res = await report(root);
  assert.equal(res.status, 200);
  const body = res.body;

  assert.equal(body.scope.unrestricted, true);

  // Users: totals agree with the roster it returns
  assert.equal(body.users.list.length, body.users.total);
  assert.equal(
    body.users.active + body.users.inactive,
    body.users.total,
    'every account is either active or not'
  );

  // Entities carry their own branch and opening counts
  assert.ok(body.entities.total >= 2);
  const entity = body.entities.list.find((e) => e.code === openings[0].school_group);
  assert.ok(entity.branches >= entity.active_branches);
  assert.ok(entity.openings >= entity.active_openings);

  // Openings: the per-opening counts add up to the intake total
  const summed = body.openings.list.reduce((sum, o) => sum + o.applications, 0);
  assert.equal(summed, body.applications.total, 'per-opening counts must total the intake');
  assert.equal(
    body.openings.active + body.openings.inactive,
    body.openings.total
  );

  // Stages: every application sits in exactly one stage
  const staged = body.applications.stages.reduce((sum, s) => sum + s.count, 0);
  assert.equal(staged, body.applications.total, 'stage counts must total the intake');

  // A fresh submission is attributed to the portal, not a partner site
  assert.ok(body.applications.by_site['Careers portal'] >= 2);
  assert.ok(body.applications.last_received_at);
});

test('a scoped admin sees only their own branch', async () => {
  const root = await rootToken();
  const branches = (await request('/admin/branches', { token: root })).body.branches;
  const openings = (await request('/openings')).body.openings;
  const mine = branches.find((b) => openings.some((o) => o.branch === b.name));
  const theirs = branches.find(
    (b) => b.id !== mine.id && openings.some((o) => o.branch === b.name)
  );
  const mineOpening = openings.find((o) => o.branch === mine.name);
  const theirsOpening = openings.find((o) => o.branch === theirs.name);

  await submitApplication({ name: 'Mine', mobile: '9700001001', openingId: mineOpening.id });
  await submitApplication({ name: 'Theirs', mobile: '9700001002', openingId: theirsOpening.id });

  // reports.view is granted deliberately; note the role has no users.manage
  const scopedRoleId = await createRole(root, 'Branch Reporter', [
    'applications.view',
    'reports.view',
  ]);
  const scoped = await createUserAndSignIn(root, {
    name: 'Branch Reporter',
    email: 'branchreport@test.local',
    roleId: scopedRoleId,
    school_group: mine.school_group,
    branch_id: mine.id,
  });

  const res = await report(scoped.token);
  assert.equal(res.status, 200);
  const body = res.body;

  assert.equal(body.scope.branch, mine.name);
  assert.equal(body.scope.unrestricted, false);

  // Openings and applications are limited to the branch
  assert.ok(body.openings.list.length > 0);
  assert.ok(
    body.openings.list.every((o) => o.branch === mine.name),
    'another branch must not appear in the openings list'
  );

  const rootBody = (await report(root)).body;
  assert.ok(
    body.applications.total < rootBody.applications.total,
    'a branch total must be smaller than the instance total'
  );

  // Only the branch's own entity is described
  assert.equal(body.entities.list.length, 1);
  assert.equal(body.entities.list[0].code, mine.school_group);
  assert.ok(body.entities.branches.every((b) => b.name === mine.name));

  // Without users.manage the roster is withheld rather than leaked
  assert.equal(body.users.restricted, true);
  assert.deepEqual(body.users.list, []);
});

test('the CSV export carries the same numbers as the page', async () => {
  const root = await rootToken();
  const body = (await report(root, 7)).body;

  const res = await request('/admin/reports/export?days=7', { token: root, raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /careers-report-\d{4}-\d{2}-\d{2}\.csv/);

  const csv = await res.text();
  assert.match(csv, /Careers portal report/);
  assert.match(csv, /Period,Last 7 days/);
  // Section headings a reader would look for
  for (const heading of ['Users', 'Entities', 'Branches', 'Job openings', 'Applications']) {
    assert.ok(csv.includes(heading), `the export should have a ${heading} section`);
  }
  // The intake total appears as its own row
  assert.ok(
    csv.includes(`Total,${body.applications.total}`),
    'the application total must match the JSON report'
  );
});

test('the period only moves the windowed counters', async () => {
  const root = await rootToken();
  const week = (await report(root, 7)).body;
  const quarter = (await report(root, 90)).body;

  assert.equal(week.period_days, 7);
  assert.equal(quarter.period_days, 90);
  // All-time totals do not depend on the window
  assert.equal(week.applications.total, quarter.applications.total);
  assert.equal(week.openings.total, quarter.openings.total);
  // ...but the windowed ones never exceed it
  assert.ok(week.applications.in_period <= quarter.applications.in_period);
  assert.ok(quarter.applications.in_period <= quarter.applications.total);
});
