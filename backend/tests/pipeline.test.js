// Application intake, the hiring pipeline, CSV import and export.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer,
  stopServer,
  request,
  rootToken,
  submitApplication,
} = require('./helpers');

test.before(startServer);
test.after(stopServer);

const firstOpening = async () => (await request('/openings')).body.openings[0];

test('an application is accepted once and only once per position', async () => {
  const opening = await firstOpening();
  const first = await submitApplication({ name: 'Asha Rao', mobile: '9900000001', openingId: opening.id });
  assert.equal(first.status, 200);

  const duplicate = await submitApplication({
    name: 'Asha Rao',
    mobile: '9900000001',
    openingId: opening.id,
  });
  assert.equal(duplicate.status, 409);

  // The unique index, not the check-then-insert, is what actually holds
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      submitApplication({ name: 'Race', mobile: '9900000002', openingId: opening.id })
    )
  );
  const accepted = concurrent.filter((r) => r.status === 200).length;
  assert.equal(accepted, 1, 'exactly one concurrent submission should win');
});

test('intake validation', async () => {
  const opening = await firstOpening();
  const cases = [
    [{ name: 'Ab', mobile: '9900001001' }, 'name too short'],
    [{ name: 'Valid Name', mobile: '123' }, 'mobile not 10 digits'],
    [{ name: 'Valid Name', mobile: '9900001002', experience: '99' }, 'experience out of range'],
  ];
  for (const [payload, why] of cases) {
    const res = await submitApplication({ openingId: opening.id, ...payload });
    assert.equal(res.status, 400, why);
  }

  // Non-ASCII names are people's actual names, and must be accepted
  const unicode = await submitApplication({
    name: 'José Álvarez',
    mobile: '9900001010',
    openingId: opening.id,
  });
  assert.equal(unicode.status, 200);

  // A closed opening takes no more applications
  const root = await rootToken();
  await request(`/admin/openings/${opening.id}`, {
    method: 'PUT',
    token: root,
    body: { ...opening, is_active: false },
  });
  const closed = await submitApplication({
    name: 'Too Late',
    mobile: '9900001020',
    openingId: opening.id,
  });
  assert.equal(closed.status, 400);
  await request(`/admin/openings/${opening.id}`, {
    method: 'PUT',
    token: root,
    body: { ...opening, is_active: true },
  });
});

test('the interview chain only opens one stage at a time', async () => {
  const root = await rootToken();
  const opening = await firstOpening();
  await submitApplication({ name: 'Chain Test', mobile: '9900002001', openingId: opening.id });
  const app = (await request('/admin/applications?search=Chain Test', { token: root })).body
    .applications[0];

  // No round is writable before screening opens the gate
  let res = await request(`/admin/applications/${app.id}/rounds/1`, {
    method: 'PUT',
    token: root,
    body: { feedback: 'too early', status: 'hold' },
  });
  assert.equal(res.status, 400);

  await request(`/admin/applications/${app.id}/screening`, {
    method: 'PUT',
    token: root,
    body: { status: 'shortlisted', next_round: true, next_assigned_name: 'Panel A' },
  });
  res = await request(`/admin/applications/${app.id}/rounds/1`, {
    method: 'PUT',
    token: root,
    body: { feedback: 'strong', status: 'shortlisted', next_round: true },
  });
  assert.equal(res.status, 200);
  // Saving a round advances a shortlisted candidate
  assert.equal(res.body.application.screening_status, 'in_interview');

  // Closing the screening gate closes the whole branch, not just round 1
  await request(`/admin/applications/${app.id}/screening`, {
    method: 'PUT',
    token: root,
    body: { next_round: false },
  });
  for (const round of [1, 2]) {
    const blocked = await request(`/admin/applications/${app.id}/rounds/${round}`, {
      method: 'PUT',
      token: root,
      body: { feedback: 'after the gate closed', status: 'hold' },
    });
    assert.equal(blocked.status, 400, `round ${round} must be closed too`);
  }
});

test('a screening save only writes the fields it was given', async () => {
  const root = await rootToken();
  const opening = await firstOpening();
  await submitApplication({ name: 'Partial Save', mobile: '9900003001', openingId: opening.id });
  const app = (await request('/admin/applications?search=Partial Save', { token: root })).body
    .applications[0];

  await request(`/admin/applications/${app.id}/screening`, {
    method: 'PUT',
    token: root,
    body: {
      status: 'shortlisted',
      experience: '9',
      current_salary: '6 LPA',
      comments: 'KEEP ME',
      location: 'Hyderabad',
      relocate: true,
      next_round: false,
    },
  });
  // A second admin saves only the status from a different screen
  await request(`/admin/applications/${app.id}/screening`, {
    method: 'PUT',
    token: root,
    body: { status: 'hold' },
  });

  const after = (await request(`/admin/applications/${app.id}`, { token: root })).body.application;
  assert.equal(after.screening_status, 'hold');
  assert.equal(after.screening_comments, 'KEEP ME', 'omitted fields must survive');
  assert.equal(after.screening_current_salary, '6 LPA');
  assert.equal(after.screening_location, 'Hyderabad');
});

test('profile stages and suggested roles must exist', async () => {
  const root = await rootToken();
  const opening = await firstOpening();
  await submitApplication({ name: 'Stage Test', mobile: '9900004001', openingId: opening.id });
  const app = (await request('/admin/applications?search=Stage Test', { token: root })).body
    .applications[0];

  const bogus = await request(`/admin/applications/${app.id}/screening`, {
    method: 'PUT',
    token: root,
    body: { status: 'not_a_real_stage' },
  });
  assert.equal(bogus.status, 400);

  const freeText = await request(`/admin/applications/${app.id}/suggestion`, {
    method: 'PUT',
    token: root,
    body: { suggested_role: '<img src=x onerror=alert(1)>' },
  });
  assert.equal(freeText.status, 400);

  // A stage in use cannot be deleted out from under the applicant
  const created = await request('/admin/flow-options', {
    method: 'POST',
    token: root,
    body: { type: 'profile_stage', label: 'Offer Released', color: '#059669' },
  });
  await request(`/admin/applications/${app.id}/screening`, {
    method: 'PUT',
    token: root,
    body: { status: created.body.option.key },
  });
  const del = await request(`/admin/flow-options/${created.body.option.id}`, {
    method: 'DELETE',
    token: root,
  });
  assert.equal(del.status, 409);

  // Deactivating it instead must not jam the applicant's screening form
  await request(`/admin/flow-options/${created.body.option.id}`, {
    method: 'PUT',
    token: root,
    body: { is_active: false },
  });
  const resave = await request(`/admin/applications/${app.id}/screening`, {
    method: 'PUT',
    token: root,
    body: { status: created.body.option.key, comments: 'still editable' },
  });
  assert.equal(resave.status, 200);
});

test('resumes are private and only reachable through the portal', async () => {
  const root = await rootToken();
  const opening = await firstOpening();
  await submitApplication({ name: 'Resume Test', mobile: '9900005001', openingId: opening.id });
  const app = (await request('/admin/applications?search=Resume Test', { token: root })).body
    .applications[0];

  // The old public path is closed
  const publicPath = await request('/files/resumes/anything.pdf', { raw: true });
  assert.equal(publicPath.status, 403);

  // Unauthenticated access to the admin route is refused
  const anon = await request(`/admin/applications/${app.id}/resume`, { raw: true });
  assert.equal(anon.status, 401);

  // A signed-in admin in scope gets the file, sandboxed and uncached
  const res = await request(`/admin/applications/${app.id}/resume`, { token: root, raw: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  const body = Buffer.from(await res.arrayBuffer());
  assert.match(body.toString('utf8'), /%PDF/);
});

test('CSV import: templates are accepted, wrong files are not', async () => {
  const root = await rootToken();
  const branches = (await request('/admin/branches', { token: root })).body.branches.filter(
    (b) => b.is_active
  );
  const b = branches[0];

  const upload = async (path, csv) => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(csv)], { type: 'text/csv' }), 'import.csv');
    return request(path, { method: 'POST', token: root, body: form });
  };

  const usersCsv = `name,email,role,entity,branch\r\nAsha Rao,asha@example.com,Admin,${b.school_group},"${b.name}"\r\n`;
  const openingsCsv = `entity,branch,position,category,curriculum,description\r\n${b.school_group},"${b.name}",QA Test Position,Academic,CBSE,Any graduate\r\n`;
  const flowCsv = 'label,type,color,category\r\nQA Test Role,suggested_role,,Academic\r\n';

  const u = await upload('/admin/users/import', usersCsv);
  assert.equal(u.body.imported, 1, JSON.stringify(u.body.errors));
  // Re-running the same file changes nothing
  assert.equal((await upload('/admin/users/import', usersCsv)).body.skipped, 1);

  assert.equal((await upload('/admin/openings/import', openingsCsv)).body.imported, 1);
  assert.equal((await upload('/admin/flow-options/import', flowCsv)).body.imported, 1);

  // Templates must not import into each other's endpoints
  assert.equal((await upload('/admin/openings/import', usersCsv)).status, 400);
  assert.equal((await upload('/admin/flow-options/import', usersCsv)).status, 400);
  assert.equal((await upload('/admin/users/import', openingsCsv)).status, 400);

  // Nor should an unreadable file be reported as "0 imported"
  const utf16 = Buffer.from('label,type\nSomething,suggested_role\n', 'utf16le');
  const form = new FormData();
  form.append('file', new Blob([utf16], { type: 'text/csv' }), 'utf16.csv');
  const bad = await request('/admin/flow-options/import', { method: 'POST', token: root, body: form });
  assert.equal(bad.status, 400);

  // Error rows point at the physical spreadsheet line
  const withBlanks = 'name,email\nA One,a1@ex.com\n\n\nB Two,notanemail\n';
  const rows = await upload('/admin/users/import', withBlanks);
  assert.equal(rows.body.errors[0].row, 5);
});

test('export needs an approval code bound to the exact filters', async () => {
  const root = await rootToken();
  const noCode = await request('/admin/applications/export', { token: root, raw: true });
  assert.equal(noCode.status, 403);

  const wrongCode = await request('/admin/applications/export?otp=123456', {
    token: root,
    raw: true,
  });
  assert.equal(wrongCode.status, 403);
});

test('dashboard totals are internally consistent', async () => {
  const root = await rootToken();
  const stats = (await request('/admin/applications/stats', { token: root })).body;
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  assert.equal(sum(stats.byStage), stats.total, 'byStage must account for every application');
  assert.equal(sum(stats.bySource), stats.total, 'bySource must account for every application');
  assert.equal(sum(stats.byGroup), stats.total, 'byGroup must account for every application');
});
