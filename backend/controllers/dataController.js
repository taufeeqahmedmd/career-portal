// Read-only data feed for BI and reporting tools: Power BI, Excel, Tableau,
// Google Sheets through Apps Script, or any script that can send a header.
//
//   GET /api/data                every dataset in one JSON document
//   GET /api/data/:dataset       one dataset, JSON (default) or ?format=csv
//
// Authenticated by a *reporting* API key (middlewares/apiKey.js). A key issued
// for one entity sees that entity's slice - the same slice an entity admin
// sees, including leads handed over to it - and an unscoped key sees all.
//
// Every dataset is a flat table with stable snake_case column names, identical
// in JSON and CSV, so a report built on one format keeps working on the other.
// Rows are streamed through a cursor, as the admin CSV export is: no row cap,
// constant memory. Each response is read inside one REPEATABLE READ snapshot,
// so the tables in a single /api/data call always agree with each other.

const db = require('../db');
const { escapeCell } = require('../utils/csv');
const { isValidDate } = require('../utils/validate');
const { fail, oneError, FieldErrors, CODES } = require('../utils/errors');

const APP_TZ = process.env.APP_TIMEZONE || 'UTC';
const BATCH = Number(process.env.EXPORT_BATCH_SIZE || 500);
const CRLF = '\r\n';

// Which applications a request covers: the key's entity and the optional
// submission-date window. Interview rounds and activity are filtered through
// their application, so the three tables always describe the same candidates.
function applicationFilter(filters) {
  const clauses = [];
  const params = [];
  if (filters.entity) {
    clauses.push('(a.school_group = ? OR a.referred_entity = ?)');
    params.push(filters.entity, filters.entity);
  }
  if (filters.from) {
    clauses.push('(a.created_at AT TIME ZONE ?)::date >= ?::date');
    params.push(APP_TZ, filters.from);
  }
  if (filters.to) {
    clauses.push('(a.created_at AT TIME ZONE ?)::date <= ?::date');
    params.push(APP_TZ, filters.to);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

// Reference tables are narrowed by entity only; the date window is about intake
const entityFilter = (filters, column) =>
  filters.entity
    ? { where: `WHERE ${column} = ?`, params: [filters.entity] }
    : { where: '', params: [] };

// Insertion order is the order /api/data writes them in
const DATASETS = {
  applications: (filters) => {
    const { where, params } = applicationFilter(filters);
    return {
      // The first placeholder is the timezone for submitted_date
      params: [APP_TZ, ...params],
      sql: `
        SELECT a.id,
               a.created_at AS submitted_at,
               (a.created_at AT TIME ZONE ?)::date AS submitted_date,
               a.last_activity_at,
               a.full_name,
               a.email,
               a.mobile,
               a.opening_id,
               a.position,
               a.branch,
               a.school_group AS entity,
               o.category,
               o.curriculum,
               a.experience_years,
               a.current_company,
               a.qualification,
               COALESCE(NULLIF(a.screening_status, ''), 'new') AS stage_key,
               COALESCE(st.label, NULLIF(a.screening_status, ''), 'New') AS stage,
               a.screening_experience,
               a.screening_current_salary,
               a.screening_expected_salary,
               a.screening_location,
               a.screening_relocate = 1 AS willing_to_relocate,
               a.screening_comments,
               a.screening_next_round = 1 AS next_round_after_screening,
               rc.rounds AS interview_rounds,
               rc.reached_interview,
               COALESCE(lst.label, lr.status) AS latest_round_status,
               lr.assignee AS latest_round_assignee,
               a.suggested_role,
               a.referred_entity,
               a.referred_branch,
               COALESCE(a.referral_employee_name, '') <> '' AS is_employee_referral,
               a.referral_employee_code,
               a.referral_employee_name,
               a.referral_employee_contact,
               a.referral_employee_branch AS referral_employee_department,
               COALESCE(NULLIF(a.source, ''), 'Website') AS source,
               COALESCE(NULLIF(a.submitted_via, ''), 'Careers portal') AS submitted_via,
               a.utm_source,
               a.utm_medium,
               a.utm_campaign,
               a.utm_term,
               a.utm_content,
               a.gclid,
               a.fbclid,
               a.tracking_params,
               a.resume_link
          FROM applications a
          LEFT JOIN openings o ON o.id = a.opening_id
          LEFT JOIN flow_options st
                 ON st.type = 'profile_stage'
                AND st.key = COALESCE(NULLIF(a.screening_status, ''), 'new')
          -- "Reached interview" matches the dashboard: a round row only counts
          -- once it has been filled in, not when it was opened to carry an
          -- assignment
          LEFT JOIN LATERAL (
                 SELECT COUNT(*) AS rounds,
                        COALESCE(BOOL_OR(ir.feedback <> '' OR ir.status <> 'in_process'), false)
                          AS reached_interview
                   FROM interview_rounds ir
                  WHERE ir.application_id = a.id
               ) rc ON true
          LEFT JOIN LATERAL (
                 SELECT ir.status, COALESCE(NULLIF(ir.assigned_name, ''), u.name, '') AS assignee
                   FROM interview_rounds ir
                   LEFT JOIN users u ON u.id = ir.assigned_to
                  WHERE ir.application_id = a.id
                  ORDER BY ir.round_no DESC
                  LIMIT 1
               ) lr ON true
          LEFT JOIN flow_options lst ON lst.type = 'profile_stage' AND lst.key = lr.status
          ${where}
         ORDER BY a.id`,
    };
  },

  interview_rounds: (filters) => {
    const { where, params } = applicationFilter(filters);
    return {
      params,
      sql: `
        SELECT ir.id,
               ir.application_id,
               ir.round_no,
               ir.status AS status_key,
               COALESCE(fo.label, ir.status) AS status,
               (ir.feedback <> '' OR ir.status <> 'in_process') AS took_place,
               ir.feedback,
               COALESCE(NULLIF(ir.assigned_name, ''), au.name, '') AS assigned_to,
               ir.assigned_to AS assigned_to_user_id,
               ir.next_round = 1 AS next_round,
               uu.name AS updated_by,
               ir.updated_by AS updated_by_user_id,
               ir.created_at,
               ir.updated_at
          FROM interview_rounds ir
          JOIN applications a ON a.id = ir.application_id
          LEFT JOIN users au ON au.id = ir.assigned_to
          LEFT JOIN users uu ON uu.id = ir.updated_by
          LEFT JOIN flow_options fo ON fo.type = 'profile_stage' AND fo.key = ir.status
          ${where}
         ORDER BY ir.id`,
    };
  },

  activity: (filters) => {
    const { where, params } = applicationFilter(filters);
    return {
      params: [APP_TZ, ...params],
      sql: `
        SELECT act.id,
               act.application_id,
               act.action,
               act.detail,
               -- NULL actor: the applicant, through the public form
               u.name AS actor,
               act.actor_id AS actor_user_id,
               act.created_at,
               (act.created_at AT TIME ZONE ?)::date AS created_date
          FROM application_activity act
          JOIN applications a ON a.id = act.application_id
          LEFT JOIN users u ON u.id = act.actor_id
          ${where}
         ORDER BY act.id`,
    };
  },

  openings: (filters) => {
    const { where, params } = entityFilter(filters, 'o.school_group');
    return {
      params,
      sql: `
        SELECT o.id,
               o.position,
               o.branch,
               o.school_group AS entity,
               o.category,
               o.curriculum,
               o.eligibility,
               o.is_active = 1 AS is_active,
               (SELECT COUNT(*) FROM applications ap WHERE ap.opening_id = o.id) AS applications,
               u.name AS created_by,
               o.created_by_id AS created_by_user_id,
               o.created_at,
               o.updated_at
          FROM openings o
          LEFT JOIN users u ON u.id = o.created_by_id
          ${where}
         ORDER BY o.id`,
    };
  },

  branches: (filters) => {
    const { where, params } = entityFilter(filters, 'b.school_group');
    return {
      params,
      sql: `
        SELECT b.id, b.name, b.school_group AS entity, b.is_active = 1 AS is_active, b.created_at
          FROM branches b
          ${where}
         ORDER BY b.id`,
    };
  },

  entities: (filters) => {
    const { where, params } = entityFilter(filters, 'e.code');
    return {
      params,
      sql: `
        SELECT e.id, e.code, e.name, e.color, e.is_active = 1 AS is_active, e.created_at
          FROM entities e
          ${where}
         ORDER BY e.id`,
    };
  },

  // Staff accounts, for "who did what" reports. Credentials, two-factor state
  // and password status are deliberately left out.
  users: (filters) => {
    const { where, params } = entityFilter(filters, 'u.school_group');
    return {
      params,
      sql: `
        SELECT u.id,
               u.name,
               u.email,
               r.name AS role,
               u.school_group AS entity,
               b.name AS branch,
               u.is_active = 1 AS is_active,
               u.last_login_at,
               u.created_at
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          LEFT JOIN branches b ON b.id = u.branch_id
          ${where}
         ORDER BY u.id`,
    };
  },

  // Pipeline configuration: stage labels, colours and order, so a report can
  // sort stages the way the admin panel does. Global, not entity-scoped.
  flow_options: () => ({
    params: [],
    sql: `
      SELECT fo.id,
             fo.type,
             fo.key,
             fo.label,
             fo.color,
             fo.category,
             fo.sort_order,
             fo.is_system = 1 AS is_system,
             fo.is_active = 1 AS is_active
        FROM flow_options fo
       ORDER BY fo.type, fo.sort_order, fo.id`,
  }),
};

const DATASET_NAMES = Object.keys(DATASETS);

// Thrown to unwind the snapshot when the caller hangs up mid-download
const ABORTED = new Error('client disconnected');

// Query-string options shared by both endpoints. Sends a 400 and returns null
// when they are unusable: silently ignoring a bad date would return every row
// and look like a correct answer.
function readOptions(req, res) {
  const { from, to } = req.query;
  const format = String(req.query.format || 'json').toLowerCase();

  const errors = new FieldErrors()
    .check(!from || isValidDate(from), 'from', CODES.INVALID, 'from must be a date as YYYY-MM-DD.')
    .check(!to || isValidDate(to), 'to', CODES.INVALID, 'to must be a date as YYYY-MM-DD.')
    .check(['json', 'csv'].includes(format), 'format', CODES.INVALID, 'format must be json or csv.');
  if (errors.any) {
    fail(res, 400, errors.items);
    return null;
  }

  return {
    format,
    filters: { entity: req.apiKey.entity_code, from: from || null, to: to || null },
  };
}

// Writes with backpressure. Resolves once the socket can take more, or once the
// caller has gone - in which case the next write rejects and the read stops.
function writerFor(res, state) {
  return (chunk) => {
    if (state.closed) return Promise.reject(ABORTED);
    if (res.write(chunk)) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        res.off('drain', done);
        res.off('close', done);
        resolve();
      };
      res.on('drain', done);
      res.on('close', done);
    });
  };
}

// Runs `work` inside one read-only snapshot and ends the response. A cursor
// needs a transaction anyway, which is also what keeps it safe behind a
// transaction-mode connection pooler.
async function inSnapshot(res, work) {
  const client = await db.pool.connect();
  const state = { closed: false };
  res.on('close', () => {
    state.closed = true;
  });

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // now() is the transaction's start, i.e. the moment the data describes
    const { rows } = await client.query('SELECT now() AS at');
    const result = await work(client, writerFor(res, state), rows[0].at);
    await client.query('COMMIT');
    res.end();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is already broken
    }
    if (err === ABORTED) return null;
    // Nothing sent yet: let the error handler answer properly
    if (!res.headersSent) {
      res.removeHeader('Content-Disposition');
      throw err;
    }
    console.error('Data feed failed:', err.message);
    // Headers are out, so the only honest signal is an aborted transfer rather
    // than a file that looks complete
    res.destroy(err);
    return null;
  } finally {
    client.release();
  }
}

// Reads one dataset through a cursor and hands each batch to `emit`. The first
// batch is always emitted, even when empty, because it carries the column names
// a CSV header needs.
async function streamDataset(client, name, filters, emit) {
  const { sql, params } = DATASETS[name](filters);
  const cursor = `data_${name}`;
  await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${db.toPg(sql)}`, params);

  let count = 0;
  for (let first = true; ; first = false) {
    const batch = await client.query(`FETCH ${BATCH} FROM ${cursor}`);
    await emit(batch.rows, batch.fields, first);
    count += batch.rows.length;
    if (batch.rows.length < BATCH) break;
  }

  await client.query(`CLOSE ${cursor}`);
  return count;
}

// Rows as the elements of a JSON array; the caller writes the brackets
function jsonRows(write) {
  let written = false;
  return async (rows) => {
    if (!rows.length) return;
    let chunk = '';
    for (const row of rows) {
      chunk += `${written ? ',' : ''}\n${JSON.stringify(row)}`;
      written = true;
    }
    await write(chunk);
  };
}

function csvRows(write) {
  return async (rows, fields, first) => {
    const names = fields.map((f) => f.name);
    let chunk = first ? names.map(escapeCell).join(',') + CRLF : '';
    for (const row of rows) chunk += names.map((n) => escapeCell(row[n])).join(',') + CRLF;
    if (chunk) await write(chunk);
  };
}

// Reading candidate data in bulk should leave a trace in the server log
const logRead = (key, what, rows) =>
  console.log(`Data feed: key #${key.id} (${key.name}) read ${what}, ${rows} rows`);

const noStore = (res) => {
  // Candidate data: never let a proxy hold on to it
  res.setHeader('Cache-Control', 'private, no-store');
};

// GET /api/data - everything, as one JSON document
exports.all = async (req, res) => {
  const options = readOptions(req, res);
  if (!options) return;
  if (options.format !== 'json') {
    return fail(
      res,
      400,
      oneError(
        'format',
        CODES.INVALID,
        'A CSV file holds one table. Request /api/data/<dataset>?format=csv for each one you need.'
      )
    );
  }
  const { filters } = options;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  noStore(res);

  const total = await inSnapshot(res, async (client, write, generatedAt) => {
    const head = {
      generated_at: generatedAt,
      timezone: APP_TZ,
      entity: filters.entity,
      from: filters.from,
      to: filters.to,
      datasets: DATASET_NAMES,
    };
    // Open the object with the metadata, then append one array per dataset
    await write(JSON.stringify(head).slice(0, -1));

    let rows = 0;
    for (const name of DATASET_NAMES) {
      await write(`,\n${JSON.stringify(name)}:[`);
      rows += await streamDataset(client, name, filters, jsonRows(write));
      await write('\n]');
    }
    await write('}\n');
    return rows;
  });

  if (total !== null) logRead(req.apiKey, 'all datasets', total);
};

// GET /api/data/:dataset - one table
exports.dataset = async (req, res) => {
  const name = req.params.dataset;
  if (!Object.hasOwn(DATASETS, name)) {
    return fail(
      res,
      404,
      oneError(
        'dataset',
        CODES.NOT_FOUND,
        `Unknown dataset. Available: ${DATASET_NAMES.join(', ')}.`
      )
    );
  }
  const options = readOptions(req, res);
  if (!options) return;
  const { format, filters } = options;

  noStore(res);
  if (format === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.csv"`);
  } else {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }

  const total = await inSnapshot(res, async (client, write) => {
    if (format === 'csv') {
      // BOM so Excel opens UTF-8 names correctly
      await write('﻿');
      return streamDataset(client, name, filters, csvRows(write));
    }
    await write('[');
    const rows = await streamDataset(client, name, filters, jsonRows(write));
    await write('\n]\n');
    return rows;
  });

  if (total !== null) logRead(req.apiKey, `${name} as ${format}`, total);
};

exports.DATASET_NAMES = DATASET_NAMES;
