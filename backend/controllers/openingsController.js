const db = require('../db');

const { scopeFor } = require('../utils/scope');
const { isActiveEntityCode } = require('./entitiesController');
const { parseCsvFile, pick, MAX_ROWS, checkHeaders, HEADER_RULES } = require('../utils/csvImport');
const { validId } = require('../utils/validate');

// Only openings whose branch AND entity are also active reach the careers site
exports.listPublic = async (req, res) => {
  const openings = await db.all(
    `SELECT o.id, o.position, o.branch, o.school_group, o.eligibility, o.category, o.curriculum
     FROM openings o
     JOIN entities e ON e.code = o.school_group AND e.is_active = 1
     JOIN branches b ON b.name = o.branch AND b.school_group = o.school_group AND b.is_active = 1
     WHERE o.is_active = 1
     ORDER BY o.school_group, o.branch, o.position`
  );
  res.json({ openings });
};

const LIST_SELECT = `
  SELECT o.*, u.name AS created_by
  FROM openings o
  LEFT JOIN users u ON u.id = o.created_by_id
`;

exports.listAll = async (req, res) => {
  const scope = scopeFor(req.user);
  let openings;
  if (scope.branch) {
    openings = await db.all(
      `${LIST_SELECT} WHERE o.branch = ? AND o.school_group = ? ORDER BY o.is_active DESC, o.position`,
      scope.branch,
      scope.group
    );
  } else if (scope.group) {
    openings = await db.all(
      `${LIST_SELECT} WHERE o.school_group = ? ORDER BY o.is_active DESC, o.branch, o.position`,
      scope.group
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

exports.create = async (req, res) => {
  const scope = scopeFor(req.user);
  const body = { ...(req.body || {}) };
  if (scope.group) body.school_group = scope.group;
  if (scope.branch) body.branch = scope.branch;

  const data = await validateOpening(body, { requireActiveBranch: true });
  if (data.error) return res.status(400).json({ error: data.error });

  const result = await db.run(
    'INSERT INTO openings (position, branch, school_group, eligibility, category, curriculum, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    data.position,
    data.branch,
    data.school_group,
    data.eligibility,
    data.category,
    data.curriculum,
    req.user.id
  );

  const opening = await db.get('SELECT * FROM openings WHERE id = ?', result.rows[0].id);
  res.status(201).json({ opening });
};

exports.update = async (req, res) => {
  const existing = await db.get('SELECT * FROM openings WHERE id = ?', validId(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Opening not found.' });

  const scope = scopeFor(req.user);
  if (scope.group && existing.school_group !== scope.group) {
    return res.status(403).json({ error: 'You can only manage openings for your school group.' });
  }
  if (scope.branch && existing.branch !== scope.branch) {
    return res.status(403).json({ error: 'You can only manage openings for your branch.' });
  }

  const body = { ...(req.body || {}) };
  if (scope.group) body.school_group = scope.group;
  if (scope.branch) body.branch = scope.branch;

  const merged = { ...existing, ...body };
  // Only demand a known active branch when the branch is being changed,
  // so legacy openings whose branch was later removed can still be edited/closed.
  const branchChanged =
    body.branch !== undefined && String(body.branch).trim() !== existing.branch;
  const data = await validateOpening(merged, { requireActiveBranch: branchChanged });
  if (data.error) return res.status(400).json({ error: data.error });

  const isActive =
    req.body && req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;

  await db.run(
    'UPDATE openings SET position = ?, branch = ?, school_group = ?, eligibility = ?, category = ?, curriculum = ?, is_active = ?, updated_at = now() WHERE id = ?',
    data.position,
    data.branch,
    data.school_group,
    data.eligibility,
    data.category,
    data.curriculum,
    isActive,
    existing.id
  );

  const opening = await db.get('SELECT * FROM openings WHERE id = ?', existing.id);
  res.json({ opening });
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
