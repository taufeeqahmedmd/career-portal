const db = require('../db');
const { parseCsvFile, pick, MAX_ROWS, checkHeaders, HEADER_RULES } = require('../utils/csvImport');
const { validId, str } = require('../utils/validate');

const HEX = /^#[0-9a-fA-F]{6}$/;
const TYPES = ['profile_stage', 'assignee', 'suggested_role'];
// Roles/positions are split so the opening form can filter by category
const CATEGORIES = ['Academic', 'Non-Academic'];

const slugify = (label) =>
  String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'option';

// All options, for the Flow Configuration page
exports.list = async (req, res) => {
  const options = await db.all('SELECT * FROM flow_options ORDER BY type, sort_order, id');
  res.json({ options });
};

// Active options, for the pipeline dropdowns on the applicant profile
exports.listActive = async (req, res) => {
  const rows = await db.all(
    'SELECT type, key, label, color, category FROM flow_options WHERE is_active = 1 ORDER BY sort_order, id'
  );
  res.json({
    stages: rows.filter((r) => r.type === 'profile_stage'),
    assignees: rows.filter((r) => r.type === 'assignee'),
    suggested_roles: rows.filter((r) => r.type === 'suggested_role'),
  });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const type = str(body.type);
  const label = str(body.label);
  const color = str(body.color) || '#78716c';

  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid option type.' });
  if (!label) return res.status(400).json({ error: 'A label is required.' });
  if (label.length > 120) {
    return res.status(400).json({ error: 'Label is too long (maximum 120 characters).' });
  }
  if (!HEX.test(color)) return res.status(400).json({ error: 'Color must be a hex value like #059669.' });

  const base = slugify(label);
  let key = base;
  let n = 1;
  while (await db.get('SELECT id FROM flow_options WHERE type = ? AND key = ?', type, key)) {
    key = `${base}_${++n}`;
  }

  const category = (body.category || '').trim() || 'Academic';
  if (type === 'suggested_role' && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Category must be Academic or Non-Academic.' });
  }

  const maxSort = (
    await db.get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM flow_options WHERE type = ?', type)
  ).m;

  const result = await db.run(
    'INSERT INTO flow_options (type, key, label, color, category, sort_order) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    type,
    key,
    label,
    color,
    category,
    maxSort + 1
  );

  res.status(201).json({
    option: await db.get('SELECT * FROM flow_options WHERE id = ?', result.rows[0].id),
  });
};

exports.update = async (req, res) => {
  const option = await db.get('SELECT * FROM flow_options WHERE id = ?', validId(req.params.id));
  if (!option) return res.status(404).json({ error: 'Option not found.' });

  const body = req.body || {};
  const label = body.label !== undefined ? String(body.label).trim() : option.label;
  const color = body.color !== undefined ? String(body.color).trim() : option.color;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : option.is_active;
  const category =
    body.category !== undefined ? String(body.category).trim() : option.category || 'Academic';

  if (!label) return res.status(400).json({ error: 'A label is required.' });
  if (!HEX.test(color)) return res.status(400).json({ error: 'Color must be a hex value like #059669.' });
  if (option.type === 'suggested_role' && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Category must be Academic or Non-Academic.' });
  }
  if (option.is_system && !isActive) {
    return res.status(400).json({ error: 'System values are required by the flow and cannot be deactivated.' });
  }

  await db.run(
    'UPDATE flow_options SET label = ?, color = ?, category = ?, is_active = ? WHERE id = ?',
    label,
    color,
    category,
    isActive,
    option.id
  );
  res.json({ option: await db.get('SELECT * FROM flow_options WHERE id = ?', option.id) });
};

// How many records still point at this option. Deleting one that is in use
// strands those records: a profile stage becomes an unlabelled status the
// screening form cannot re-save, and the dashboard grows a phantom bucket.
async function usageCount(option) {
  if (option.type === 'profile_stage') {
    const direct = await db.get(
      'SELECT COUNT(*) AS count FROM applications WHERE screening_status = ?',
      option.key
    );
    const rounds = await db.get(
      'SELECT COUNT(*) AS count FROM interview_rounds WHERE status = ?',
      option.key
    );
    return { count: direct.count + rounds.count, noun: 'application(s)' };
  }
  if (option.type === 'suggested_role') {
    const row = await db.get(
      'SELECT COUNT(*) AS count FROM applications WHERE LOWER(suggested_role) = LOWER(?)',
      option.label
    );
    return { count: row.count, noun: 'application(s)' };
  }
  const row = await db.get(
    'SELECT COUNT(*) AS count FROM interview_rounds WHERE LOWER(assigned_name) = LOWER(?)',
    option.label
  );
  return { count: row.count, noun: 'interview round(s)' };
}

exports.remove = async (req, res) => {
  const option = await db.get('SELECT * FROM flow_options WHERE id = ?', validId(req.params.id));
  if (!option) return res.status(404).json({ error: 'Option not found.' });
  if (option.is_system) {
    return res.status(400).json({ error: 'System values are required by the flow and cannot be deleted.' });
  }

  const { count, noun } = await usageCount(option);
  if (count > 0) {
    return res.status(409).json({
      error: `"${option.label}" is used by ${count} ${noun}. Deactivate it instead - it will stay on those records but disappear from the dropdowns.`,
    });
  }

  await db.run('DELETE FROM flow_options WHERE id = ?', option.id);
  res.json({ success: true });
};

// Used by the applications controller to validate saved statuses
exports.activeStageKeys = async () =>
  (
    await db.all("SELECT key FROM flow_options WHERE type = 'profile_stage' AND is_active = 1")
  ).map((r) => r.key);

// ---- CSV import ------------------------------------------------------------
// The label's slug is the identifier: existing values are skipped.

exports.importCsv = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a CSV file to import.' });

  const { rows, headers, error } = parseCsvFile(req.file.buffer);
  if (error) return res.status(400).json({ error });
  if (!rows.length) return res.status(400).json({ error: 'The file has no data rows.' });
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows - the limit is ${MAX_ROWS}.` });
  }
  const headerError = checkHeaders(headers, HEADER_RULES.flowOptions);
  if (headerError) return res.status(400).json({ error: headerError });

  // Defaults to the roles/positions list unless the file says otherwise
  const defaultType = TYPES.includes(req.query.type) ? req.query.type : 'suggested_role';
  const results = { imported: 0, skipped: 0, failed: 0, errors: [] };
  const seen = new Set();

  for (const row of rows) {
    const label = pick(row, 'label', 'name', 'role', 'position', 'value', 'title');
    const type = pick(row, 'type') || defaultType;
    const color = pick(row, 'color') || '#78716c';
    const category = pick(row, 'category') || 'Academic';

    const fail = (reason) => {
      results.failed += 1;
      results.errors.push({ row: row.__row, value: label || '(blank)', reason });
    };

    if (!label) continue; // blank line
    // The same rules the Add form applies - an import must not be a way to
    // create values the UI would have rejected
    if (label.length > 120) {
      fail('Label is too long (maximum 120 characters).');
      continue;
    }
    if (!TYPES.includes(type)) {
      fail(`Unknown type "${type}".`);
      continue;
    }
    if (!HEX.test(color)) {
      fail('Color must be a hex value like #059669.');
      continue;
    }
    if (type === 'suggested_role' && !CATEGORIES.includes(category)) {
      fail('Category must be Academic or Non-Academic.');
      continue;
    }

    const dedupe = `${type}|${label.toLowerCase()}`;
    if (seen.has(dedupe)) {
      results.skipped += 1;
      continue;
    }
    seen.add(dedupe);

    // The label is what identifies a value to the user. Two different labels
    // that happen to slugify the same ("!!!" and "???") are distinct values,
    // so the key gets a suffix exactly as the Add form does - previously the
    // second one was silently dropped and reported as "already exists".
    const exists = await db.get(
      'SELECT id FROM flow_options WHERE type = ? AND LOWER(label) = LOWER(?)',
      type,
      label
    );
    if (exists) {
      results.skipped += 1;
      continue;
    }

    const base = slugify(label);
    let key = base;
    let n = 1;
    while (await db.get('SELECT id FROM flow_options WHERE type = ? AND key = ?', type, key)) {
      key = `${base}_${++n}`;
    }

    const maxSort = (
      await db.get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM flow_options WHERE type = ?', type)
    ).m;
    await db.run(
      'INSERT INTO flow_options (type, key, label, color, category, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      type,
      key,
      label,
      color,
      category,
      maxSort + 1
    );
    results.imported += 1;
  }

  res.json(results);
};
