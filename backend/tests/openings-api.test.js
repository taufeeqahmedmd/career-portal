// The public vacancy feed the group's other websites build their careers pages
// on: filtering, search, sorting, paging and the single-opening endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, request } = require('./helpers');

test.before(startServer);
test.after(stopServer);

const list = (query = '') => request(`/openings${query}`);

test('with no parameters the feed is unchanged', async () => {
  const res = await list();
  assert.equal(res.status, 200);
  assert.ok(res.body.openings.length > 0);
  assert.equal(res.body.total, res.body.openings.length);
  assert.equal(res.body.count, res.body.openings.length);
  // No paging was asked for, so none is reported
  assert.equal(res.body.limit, undefined);

  const first = res.body.openings[0];
  for (const field of ['id', 'position', 'branch', 'school_group', 'eligibility', 'category']) {
    assert.ok(field in first, `${field} should be published`);
  }
  assert.ok(first.posted_at, 'a partner needs the date to show "posted on"');
});

test('filters narrow the list', async () => {
  const all = (await list()).body.openings;
  const entity = all[0].school_group;
  const branch = all[0].branch;
  const position = all[0].position;

  const byEntity = (await list(`?entity=${encodeURIComponent(entity)}`)).body.openings;
  assert.ok(byEntity.every((o) => o.school_group === entity));

  const byBranch = (await list(`?branch=${encodeURIComponent(branch)}`)).body.openings;
  assert.ok(byBranch.length > 0);
  assert.ok(byBranch.every((o) => o.branch === branch));

  const byPosition = (await list(`?position=${encodeURIComponent(position)}`)).body.openings;
  assert.ok(byPosition.length > 0);
  assert.ok(byPosition.every((o) => o.position === position));

  const academic = (await list('?category=Academic')).body.openings;
  assert.ok(academic.every((o) => o.category === 'Academic'));

  // Filters combine
  const combined = (
    await list(`?entity=${encodeURIComponent(entity)}&branch=${encodeURIComponent(branch)}`)
  ).body.openings;
  assert.ok(combined.every((o) => o.school_group === entity && o.branch === branch));

  // Unknown values are an empty list, not an error
  const none = await list('?branch=Nowhere%20At%20All');
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.openings, []);
});

test('free-text search covers position, branch and eligibility', async () => {
  const all = (await list()).body.openings;
  const word = all[0].position.split(' ')[0];

  const found = await list(`?q=${encodeURIComponent(word)}`);
  assert.equal(found.status, 200);
  assert.ok(found.body.openings.length > 0);
  assert.ok(
    found.body.openings.every(
      (o) =>
        `${o.position} ${o.branch} ${o.eligibility}`.toLowerCase().includes(word.toLowerCase())
    )
  );

  // A LIKE wildcard is matched literally, not as a wildcard
  const literal = await list('?q=%25');
  assert.equal(literal.status, 200);
  assert.deepEqual(literal.body.openings, []);
});

test('sorting and paging', async () => {
  const newest = (await list('?sort=newest')).body.openings;
  const dates = newest.map((o) => new Date(o.posted_at).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a), 'newest first');

  const byPosition = (await list('?sort=position')).body.openings.map((o) => o.position);
  assert.deepEqual(byPosition, [...byPosition].sort((a, b) => a.localeCompare(b)));

  const all = (await list()).body.openings;
  const firstPage = await list('?limit=2');
  assert.equal(firstPage.body.openings.length, 2);
  assert.equal(firstPage.body.count, 2);
  assert.equal(firstPage.body.total, all.length, 'total counts the whole match, not the page');
  assert.equal(firstPage.body.limit, 2);

  const secondPage = await list('?limit=2&offset=2');
  assert.equal(secondPage.body.offset, 2);
  const firstIds = firstPage.body.openings.map((o) => o.id);
  const secondIds = secondPage.body.openings.map((o) => o.id);
  assert.equal(firstIds.filter((id) => secondIds.includes(id)).length, 0, 'pages do not overlap');
});

test('bad parameters are rejected with the field that caused it', async () => {
  for (const [query, field] of [
    ['?category=Nonsense', 'category'],
    ['?sort=sideways', 'sort'],
    ['?limit=0', 'limit'],
    ['?limit=500', 'limit'],
    ['?offset=-1', 'offset'],
  ]) {
    const res = await list(query);
    assert.equal(res.status, 400, `${query} should be rejected`);
    assert.equal(res.body.errors[0].field, field);
  }
});

test('a single opening can be fetched for a job-detail page', async () => {
  const all = (await list()).body.openings;
  const res = await request(`/openings/${all[0].id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.opening.id, all[0].id);
  assert.ok(res.body.opening.eligibility !== undefined);

  const missing = await request('/openings/99999999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.errors[0].code, 'not_found');

  // Not a number at all
  const bad = await request('/openings/abc');
  assert.equal(bad.status, 404);
});

test('filter options come from the live vacancies', async () => {
  const all = (await list()).body.openings;
  const res = await request('/openings/filters');
  assert.equal(res.status, 200);

  assert.deepEqual(
    res.body.branches,
    [...new Set(all.map((o) => o.branch))].sort(),
    'branches should match the ones actually hiring'
  );
  assert.ok(res.body.positions.length > 0);
  assert.ok(res.body.entities.length > 0);

  // Scoped to one entity, the options are that entity's only
  const entity = all[0].school_group;
  const scoped = await request(`/openings/filters?entity=${encodeURIComponent(entity)}`);
  assert.deepEqual(scoped.body.entities, [entity]);
  assert.deepEqual(
    scoped.body.branches,
    [...new Set(all.filter((o) => o.school_group === entity).map((o) => o.branch))].sort()
  );
});
