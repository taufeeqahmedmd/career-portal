const db = require('../db');

const { scopeFor, isBranchScoped, inList, inPairs } = require('../utils/scope');
const { isActiveEntityCode } = require('./entitiesController');
const { parseCsvFile, pick, MAX_ROWS, checkHeaders, HEADER_RULES } = require('../utils/csvImport');
const { validId, str, escapeLike } = require('../utils/validate');
const { fail, oneError, CODES } = require('../utils/errors');

// Only openings whose branch AND entity are also active reach a careers site.
//
// This is what the group's other websites build their vacancy pages on, so it
// filters, searches, sorts and pages: a partner renders whatever its own design
// calls for without pulling the whole group's hiring into its page source and
// discarding most of it in JavaScript.
//
// Every parameter is optional, and with none of them the response is exactly
// what it always was - the portal's own careers page depends on that.
const PUBLIC_OPENING_COLUMNS = `
  o.id, o.position, o.branch, o.school_group, o.eligibility, o.category,
  o.curriculum, o.created_at AS posted_at, o.updated_at
`;

const PUBLIC_OPENING_FROM = `
  FROM openings o
  JOIN entities e ON e.code = o.school_group AND e.is_active = 1
  JOIN branches b ON b.name = o.branch AND b.school_group = o.school_group AND b.is_active = 1
`;

const SORTS = {
  // The portal's own grouping, and the default: entity, then branch, position
  default: 'o.school_group, o.branch, o.position',
  newest: 'o.created_at DESC, o.id DESC',
  oldest: 'o.created_at ASC, o.id ASC',
  position: 'o.position, o.branch',
  branch: 'o.branch, o.position',
};

// Builds the WHERE shared by the list, the count and the filter options
function publicFilters(query) {
  const clauses = ['o.is_active = 1'];
  const params = [];
  const invalid = [];

  const entity = str(query.entity);
  const branch = str(query.branch);
  const position = str(query.position);
  const category = str(query.category);
  const curriculum = str(query.curriculum);
  const search = str(query.q || query.search);

  // Codes and names are compared case-insensitively, like everywhere else they
  // are matched, so `?entity=dps` and `?entity=DPS` behave the same
  if (entity) {
    clauses.push('LOWER(o.school_group) = LOWER(?)');
    params.push(entity);
  }
  if (branch) {
    clauses.push('LOWER(o.branch) = LOWER(?)');
    params.push(branch);
  }
  if (position) {
    clauses.push('LOWER(o.position) = LOWER(?)');
    params.push(position);
  }
  if (category) {
    if (!CATEGORIES.some((c) => c.toLowerCase() === category.toLowerCase())) {
      invalid.push({
        field: 'category',
        code: 'invalid',
        message: `category must be one of: ${CATEGORIES.join(', ')}.`,
      });
    } else {
      clauses.push('LOWER(o.category) = LOWER(?)');
      params.push(category);
    }
  }
  if (curriculum) {
    clauses.push('LOWER(COALESCE(o.curriculum, \'\')) = LOWER(?)');
    params.push(curriculum);
  }
  if (search) {
    // Free text across the three fields a candidate would search on
    const like = `%${escapeLike(search)}%`;
    clauses.push(
      `(o.position ILIKE ? ESCAPE '\\' OR o.branch ILIKE ? ESCAPE '\\' OR o.eligibility ILIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like);
  }

  return { where: `WHERE ${clauses.join(' AND ')}`, params, invalid };
}

exports.listPublic = async (req, res) => {
  const { where, params, invalid } = publicFilters(req.query);

  const sortKey = str(req.query.sort) || 'default';
  if (!SORTS[sortKey]) {
    invalid.push({
      field: 'sort',
      code: 'invalid',
      message: `sort must be one of: ${Object.keys(SORTS).join(', ')}.`,
    });
  }

  // Paging is opt-in: without `limit` the whole matching set is returned, which
  // is what the portal's own page has always received
  const hasLimit = req.query.limit !== undefined;
  const limit = Number(req.query.limit);
  const offset = Number(req.query.offset || 0);
  if (hasLimit && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    invalid.push({
      field: 'limit',
      code: 'out_of_range',
      message: 'limit must be a whole number between 1 and 100.',
    });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    invalid.push({
      field: 'offset',
      code: 'invalid',
      message: 'offset must be zero or a positive whole number.',
    });
  }

  if (invalid.length) return fail(res, 400, invalid);

  const page = hasLimit ? `LIMIT ${limit} OFFSET ${offset}` : '';
  const openings = await db.all(
    `SELECT ${PUBLIC_OPENING_COLUMNS} ${PUBLIC_OPENING_FROM} ${where}
     ORDER BY ${SORTS[sortKey]} ${page}`,
    ...params
  );

  // Without paging the page IS the whole set, so the extra count is pointless
  const total = hasLimit
    ? Number((await db.get(`SELECT COUNT(*) AS count ${PUBLIC_OPENING_FROM} ${where}`, ...params)).count)
    : openings.length;

  res.json({ openings, total, count: openings.length, ...(hasLimit ? { limit, offset } : {}) });
};

// One opening, for a partner's job-detail page. Closed vacancies 404 rather
// than rendering a page whose apply button the API would then reject.
exports.getPublicOne = async (req, res) => {
  const opening = await db.get(
    `SELECT ${PUBLIC_OPENING_COLUMNS} ${PUBLIC_OPENING_FROM}
      WHERE o.id = ? AND o.is_active = 1`,
    validId(req.params.id)
  );
  if (!opening) {
    return fail(
      res,
      404,
      oneError('id', CODES.NOT_FOUND, 'That position is not open.')
    );
  }
  res.json({ opening });
};

// The values actually present in the current vacancy list, so a partner can
// build its dropdowns from live data instead of hardcoding branch names that
// change. Respects the same filters, so asking for one entity returns only
// that entity's branches and positions.
exports.publicFilterOptions = async (req, res) => {
  const { where, params, invalid } = publicFilters(req.query);
  if (invalid.length) return fail(res, 400, invalid);

  const rows = await db.all(
    `SELECT DISTINCT o.school_group, o.branch, o.position, o.category, o.curriculum
     ${PUBLIC_OPENING_FROM} ${where}`,
    ...params
  );

  const distinct = (key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();

  res.json({
    entities: distinct('school_group'),
    branches: distinct('branch'),
    positions: distinct('position'),
    categories: distinct('category'),
    curricula: distinct('curriculum'),
    total: rows.length,
  });
};

const LIST_SELECT = `
  SELECT o.*, u.name AS created_by
  FROM openings o
  LEFT JOIN users u ON u.id = o.created_by_id
`;

exports.listAll = async (req, res) => {
  const scope = scopeFor(req.user);
  let openings;
  if (isBranchScoped(scope)) {
    const clause = inPairs('o.branch', 'o.school_group', scope.branchPairs);
    openings = await db.all(
      `${LIST_SELECT} WHERE ${clause.sql} ORDER BY o.is_active DESC, o.branch, o.position`,
      ...clause.params
    );
  } else if (scope.groups?.length) {
    const clause = inList('o.school_group', scope.groups);
    openings = await db.all(
      `${LIST_SELECT} WHERE ${clause.sql} ORDER BY o.is_active DESC, o.school_group, o.branch, o.position`,
      ...clause.params
    );
  } else {
    openings = await db.all(
      `${LIST_SELECT} ORDER BY o.is_active DESC, o.school_group, o.branch, o.position`
    );
  }
  res.json({ openings });
};

const CATEGORIES = ['Academic', 'Non-Academic'];

async function validateOpening(body, { requireActiveBranch = false } = {}) {
  const position = (body.position || '').trim();
  const branch = (body.branch || '').trim();
  const school_group = (body.school_group || '').trim();
  const eligibility = (body.eligibility || '').trim();
  const category = (body.category || '').trim() || 'Academic';
  // Curriculum only applies to academic roles
  const curriculum =
    category === 'Academic' ? (body.curriculum || '').trim() || null : null;

  if (!position) return { error: 'Position is required.' };
  if (!branch) return { error: 'Branch is required.' };
  if (!(await isActiveEntityCode(school_group))) {
    return { error: 'Select a valid, active entity.' };
  }
  if (!CATEGORIES.includes(category)) {
    return { error: 'Category must be Academic or Non-Academic.' };
  }
  if (curriculum && !['CBSE', 'CIE'].includes(curriculum)) {
    return { error: 'Curriculum must be CBSE or CIE.' };
  }
  if (requireActiveBranch) {
    const known = await db.get(
      'SELECT id FROM branches WHERE school_group = ? AND name = ? AND is_active = 1',
      school_group,
      branch
    );
    if (!known) {
      return { error: 'Branch must be one of the active branches for that school group.' };
    }
  }
  return { position, branch, school_group, eligibility, category, curriculum };
}

// Is an (entity, branch) inside the caller's scope? Branch-scoped users are
// held to their exact branches; entity-scoped users to any branch of theirs.
function outOfScope(scope, school_group, branch) {
  if (isBranchScoped(scope)) {
    const ok = scope.branchPairs.some((p) => p.name === branch && p.group === school_group);
    return ok ? null : 'You can only manage openings for your own branches.';
  }
  if (scope.groups?.length && !scope.groups.includes(school_group)) {
    return 'You can only manage openings for your own school groups.';
  }
  return null;
}

// ---- Posting one opening to several branches -------------------------------
// An opening belongs to exactly one branch - applications, the public feed and
// every scope check key on that - so "the same vacancy at five branches" is
// five rows sharing a position and description.

const MAX_TARGETS = 100;

// `[{ school_group, branch }]` from the request, trimmed and de-duplicated
function readTargets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const targets = [];
  for (const t of list) {
    const school_group = str(t?.school_group);
    const branch = str(t?.branch);
    const key = `${school_group}|${branch}`.toLowerCase();
    if (!school_group || !branch || seen.has(key)) continue;
    seen.add(key);
    targets.push({ school_group, branch });
  }
  return targets;
}

// Checks every target against the caller's scope and the active branches, and
// splits off those where the same position is already open. Any bad target
// fails the whole request, so nothing is half-posted.
async function prepareTargets(scope, fields, targets, { excludeId = 0 } = {}) {
  if (targets.length > MAX_TARGETS) {
    return { status: 400, error: `Select at most ${MAX_TARGETS} branches at a time.` };
  }

  const ready = [];
  for (const target of targets) {
    const denied = outOfScope(scope, target.school_group, target.branch);
    if (denied) return { status: 403, error: denied };

    const data = await validateOpening({ ...fields, ...target }, { requireActiveBranch: true });
    if (data.error) {
      const error = targets.length > 1 ? `${target.branch}: ${data.error}` : data.error;
      return { status: 400, error };
    }
    ready.push(data);
  }

  const open = ready.length
    ? await db.all(
        'SELECT branch, school_group FROM openings WHERE is_active = 1 AND LOWER(position) = LOWER(?) AND id <> ?',
        ready[0].position,
        excludeId
      )
    : [];
  const isOpen = (d) => open.some((o) => o.branch === d.branch && o.school_group === d.school_group);

  return {
    rows: ready.filter((d) => !isOpen(d)),
    skipped: ready.filter(isOpen).map(({ school_group, branch }) => ({ school_group, branch })),
  };
}

async function insertOpenings(client, rows, userId) {
  const ids = [];
  for (const d of rows) {
    const result = await client.query(
      'INSERT INTO openings (position, branch, school_group, eligibility, category, curriculum, created_by_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [d.position, d.branch, d.school_group, d.eligibility, d.category, d.curriculum, userId]
    );
    ids.push(result.rows[0].id);
  }
  return ids;
}

const openingsById = (ids) =>
  ids.length ? db.all(`SELECT * FROM openings WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`, ...ids) : [];

exports.create = async (req, res) => {
  const scope = scopeFor(req.user);
  const body = { ...(req.body || {}) };

  // `targets` posts the opening to several branches at once, across entities.
  // Without it this is the single-branch form, where a single-valued scope
  // leaves nothing to choose and is pinned.
  let targets = readTargets(body.targets);
  if (!targets.length) {
    if (scope.group) body.school_group = scope.group;
    if (scope.branch) body.branch = scope.branch;
    targets = [{ school_group: str(body.school_group), branch: str(body.branch) }];
  }

  const prepared = await prepareTargets(scope, body, targets);
  if (prepared.error) return res.status(prepared.status).json({ error: prepared.error });
  if (!prepared.rows.length) {
    return res.status(409).json({
      error: 'This position is already open at the selected branches.',
      skipped: prepared.skipped,
    });
  }

  const client = await db.pool.connect();
  let ids;
  try {
    await client.query('BEGIN');
    ids = await insertOpenings(client, prepared.rows, req.user.id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const openings = await openingsById(ids);
  res.status(201).json({ opening: openings[0], openings, skipped: prepared.skipped });
};

exports.update = async (req, res) => {
  const existing = await db.get('SELECT * FROM openings WHERE id = ?', validId(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Opening not found.' });

  const scope = scopeFor(req.user);
  const deniedExisting = outOfScope(scope, existing.school_group, existing.branch);
  if (deniedExisting) return res.status(403).json({ error: deniedExisting });

  const body = { ...(req.body || {}) };
  if (scope.group) body.school_group = scope.group;
  if (scope.branch) body.branch = scope.branch;

  const merged = { ...existing, ...body };
  // The opening must still be inside the scope after the edit, or a scoped
  // admin could move one out of their own reach
  const deniedTarget = outOfScope(scope, merged.school_group, merged.branch);
  if (deniedTarget) return res.status(403).json({ error: deniedTarget });

  // Only demand a known active branch when the branch is being changed,
  // so legacy openings whose branch was later removed can still be edited/closed.
  const branchChanged =
    body.branch !== undefined && String(body.branch).trim() !== existing.branch;
  const data = await validateOpening(merged, { requireActiveBranch: branchChanged });
  if (data.error) return res.status(400).json({ error: data.error });

  const isActive =
    req.body && req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;

  // `add_branches` opens this same position, with the edited details, at more
  // branches. Each becomes its own opening; this one keeps its branch.
  const extra = readTargets(body.add_branches).filter(
    (t) => !(t.branch === data.branch && t.school_group === data.school_group)
  );
  const prepared = extra.length
    ? await prepareTargets(scope, data, extra, { excludeId: existing.id })
    : { rows: [], skipped: [] };
  if (prepared.error) return res.status(prepared.status).json({ error: prepared.error });

  const client = await db.pool.connect();
  let addedIds;
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE openings SET position = $1, branch = $2, school_group = $3, eligibility = $4, category = $5, curriculum = $6, is_active = $7, updated_at = now() WHERE id = $8',
      [
        data.position,
        data.branch,
        data.school_group,
        data.eligibility,
        data.category,
        data.curriculum,
        isActive,
        existing.id,
      ]
    );
    addedIds = await insertOpenings(client, prepared.rows, req.user.id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const opening = await db.get('SELECT * FROM openings WHERE id = ?', existing.id);
  res.json({ opening, added: await openingsById(addedIds), skipped: prepared.skipped });
};

// ---- CSV import ------------------------------------------------------------
// Branch + position is the identifier: an existing pair is skipped.

exports.importCsv = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a CSV file to import.' });

  const { rows, headers, error } = parseCsvFile(req.file.buffer);
  if (error) return res.status(400).json({ error });
  if (!rows.length) return res.status(400).json({ error: 'The file has no data rows.' });
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows - the limit is ${MAX_ROWS}.` });
  }
  const headerError = checkHeaders(headers, HEADER_RULES.openings);
  if (headerError) return res.status(400).json({ error: headerError });

  const scope = scopeFor(req.user);
  const results = { imported: 0, skipped: 0, failed: 0, errors: [] };
  const seen = new Set();

  for (const row of rows) {
    // `role` and `title` are deliberately not aliases here: they collide with
    // the users and roles templates, which used to import silently as openings
    const position = pick(row, 'position', 'job_title', 'job_role');
    const branch = pick(row, 'branch', 'branch_name');
    const entity = pick(row, 'entity', 'school_group', 'group', 'entity_code');
    const category = pick(row, 'category') || 'Academic';
    const curriculum = pick(row, 'curriculum');
    const eligibility = pick(row, 'description', 'eligibility', 'details');

    const fail = (reason) => {
      results.failed += 1;
      results.errors.push({ row: row.__row, value: `${position || '?'} - ${branch || '?'}`, reason });
    };

    if (!position && !branch && !entity) continue; // blank line

    const wantGroup = scope.group || entity;
    let wantBranch = scope.branch || branch;

    // Openings are joined to branches on the exact name, so a hand-typed file
    // with different capitalisation has to be resolved to the canonical spelling
    if (wantBranch && wantGroup) {
      const match = await db.get(
        'SELECT name FROM branches WHERE school_group = ? AND LOWER(name) = LOWER(?) AND is_active = 1',
        wantGroup,
        wantBranch
      );
      if (match) wantBranch = match.name;
    }

    // Checked against the canonical name, so a differently-cased row in the
    // file is not read as a branch the importer has no access to
    const denied = outOfScope(scope, wantGroup, wantBranch);
    if (denied) {
      fail(denied);
      continue;
    }

    const body = {
      position,
      branch: wantBranch,
      school_group: wantGroup,
      category,
      curriculum,
      eligibility,
    };

    const data = await validateOpening(body, { requireActiveBranch: true });
    if (data.error) {
      fail(data.error);
      continue;
    }

    // Same branch + position twice in the file, or already in the database
    const key = `${data.school_group}|${data.branch}|${data.position}`.toLowerCase();
    if (seen.has(key)) {
      results.skipped += 1;
      continue;
    }
    seen.add(key);

    const exists = await db.get(
      'SELECT id FROM openings WHERE LOWER(branch) = LOWER(?) AND LOWER(position) = LOWER(?) AND school_group = ?',
      data.branch,
      data.position,
      data.school_group
    );
    if (exists) {
      results.skipped += 1;
      continue;
    }

    await db.run(
      'INSERT INTO openings (position, branch, school_group, eligibility, category, curriculum, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      data.position,
      data.branch,
      data.school_group,
      data.eligibility,
      data.category,
      data.curriculum,
      req.user.id
    );
    results.imported += 1;
  }

  res.json(results);
};
