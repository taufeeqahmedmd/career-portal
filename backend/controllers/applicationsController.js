const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { toCsv, csvHeader, csvRow } = require('../utils/csv');
const fs = require('fs');
const path = require('path');
const {
  storeResume,
  discardStoredResume,
  openDriveFile,
  localResumePath,
} = require('../utils/drive');
const { buildAttribution } = require('../utils/attribution');
const { sendExportOtpEmail } = require('../utils/mailer');
const { scopeFor } = require('../utils/scope');
const { activeStageKeys } = require('./flowController');
const { validId, isValidDate, escapeLike, toBool, str } = require('../utils/validate');
const { remember, invalidate, KEYS } = require('../utils/cache');

// Day boundaries ("today", the trend chart, date filters) are evaluated in the
// school's own timezone, so an application at 01:00 IST counts as today rather
// than yesterday. Must match the timezone the admin UI runs in.
const APP_TZ = process.env.APP_TIMEZONE || 'UTC';

// PDF only. Every browser renders it natively, page layout survives exactly as
// the candidate wrote it, and reviewers never leave the portal to read a CV.
// Word formats are deliberately absent: .doc cannot be rendered in a browser at
// all, and .docx only approximately.
//
// Resumes uploaded before this rule still open - the preview handles whatever
// is already stored.
const RESUME_TYPES = {
  'application/pdf': '.pdf',
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const full_name = (body.full_name || '').trim();
  const mobile = (body.mobile || '').trim();
  const email = (body.email || '').trim();
  const experience_years = (body.experience_years || '').trim();
  const current_company = (body.current_company || '').trim();
  const referral_employee_code = (body.referral_employee_code || '').trim();
  const referral_employee_name = (body.referral_employee_name || '').trim();
  const referral_employee_branch = (body.referral_employee_branch || '').trim();
  const referral_employee_contact = (body.referral_employee_contact || '').trim();
  const hasReferral =
    referral_employee_code || referral_employee_name || referral_employee_branch || referral_employee_contact;
  const opening_id = Number(body.opening_id);
  const resume = req.file;

  if (!full_name || full_name.length < 3) {
    return res.status(400).json({ error: 'Full name is required (minimum 3 characters).' });
  }
  if (full_name.length > 120) {
    return res.status(400).json({ error: 'Full name is too long (maximum 120 characters).' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    // 254 is the maximum length of a deliverable address (RFC 5321)
    return res.status(400).json({ error: 'A valid email ID is required.' });
  }
  if (!/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ error: 'Mobile number must be exactly 10 digits.' });
  }
  if (!Number.isInteger(opening_id) || opening_id <= 0) {
    return res.status(400).json({ error: 'Please select a position.' });
  }
  if (!experience_years) {
    return res.status(400).json({ error: 'Years of experience is required.' });
  }
  const experienceValue = Number(experience_years);
  if (!Number.isFinite(experienceValue) || experienceValue < 0 || experienceValue > 60) {
    return res.status(400).json({ error: 'Years of experience must be a number between 0 and 60.' });
  }
  if (!current_company) {
    return res.status(400).json({ error: 'Please tell us where you are currently working (or "Fresher").' });
  }
  if (current_company.length > 120) {
    return res.status(400).json({ error: 'Company name is too long (maximum 120 characters).' });
  }
  if (!resume) {
    return res.status(400).json({ error: 'Resume upload is required.' });
  }
  if (!resume.size) {
    return res.status(400).json({ error: 'The uploaded resume is empty.' });
  }
  // Referral is optional, but once opted the referring employee's name and
  // mobile are required - the ID and department are nice-to-have
  if (hasReferral) {
    if (!referral_employee_name) {
      return res.status(400).json({ error: 'Referring employee name is required.' });
    }
    if (!/^\d{10}$/.test(referral_employee_contact)) {
      return res.status(400).json({ error: 'Referring employee mobile must be exactly 10 digits.' });
    }
    // Unbounded text columns otherwise: capped so a direct POST cannot bloat
    // the applicant table, the admin list and every CSV export
    if (referral_employee_name.length > 120) {
      return res.status(400).json({ error: 'Referring employee name is too long (maximum 120 characters).' });
    }
    if (referral_employee_code.length > 60) {
      return res.status(400).json({ error: 'Referring employee ID is too long (maximum 60 characters).' });
    }
    if (referral_employee_branch.length > 120) {
      return res.status(400).json({ error: 'Department is too long (maximum 120 characters).' });
    }
  }
  if (!RESUME_TYPES[resume.mimetype]) {
    return res.status(400).json({ error: 'Resume must be a PDF file.' });
  }

  // The opening, its branch and its entity must all still be active
  const opening = await db.get(
    `SELECT o.* FROM openings o
     JOIN entities e ON e.code = o.school_group AND e.is_active = 1
     JOIN branches b ON b.name = o.branch AND b.school_group = o.school_group AND b.is_active = 1
     WHERE o.id = ? AND o.is_active = 1`,
    opening_id
  );
  if (!opening) {
    return res.status(400).json({ error: 'The selected position is no longer open.' });
  }

  // Reject duplicates: same position with the same mobile number
  const duplicate = await db.get(
    'SELECT id FROM applications WHERE opening_id = ? AND mobile = ?',
    opening_id,
    mobile
  );
  if (duplicate) {
    return res.status(409).json({
      error: 'An application for this position already exists with this mobile number.',
    });
  }

  let stored;
  try {
    // Extension comes from the validated MIME type, not the uploaded filename
    stored = await storeResume(resume, full_name, RESUME_TYPES[resume.mimetype]);
  } catch (err) {
    console.error('Resume upload failed:', err);
    return res.status(502).json({ error: 'Could not upload the resume. Please try again.' });
  }

  // Where this applicant came from (UTMs / ad click ids), captured on the site
  let attributionPayload = {};
  try {
    attributionPayload = body.attribution ? JSON.parse(body.attribution) : {};
  } catch {
    attributionPayload = {};
  }
  const attr = buildAttribution(attributionPayload);

  let result;
  try {
    result = await db.run(
      `INSERT INTO applications
        (full_name, mobile, email, qualification, opening_id, position, branch, school_group, referral_employee_code, referral_employee_name, referral_employee_branch, referral_employee_contact, experience_years, current_company, resume_link, resume_file_id, screening_status,
         source, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, tracking_params)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      full_name,
      mobile,
      email,
      '',
      opening.id,
      opening.position,
      opening.branch,
      opening.school_group,
      referral_employee_code,
      referral_employee_name,
      referral_employee_branch,
      referral_employee_contact,
      experienceValue,
      current_company,
      stored.link,
      stored.fileId,
      attr.source,
      attr.utm_source,
      attr.utm_medium,
      attr.utm_campaign,
      attr.utm_term,
      attr.utm_content,
      attr.gclid,
      attr.fbclid,
      attr.tracking_params
    );
  } catch (err) {
    // The duplicate check above is a race on its own; the unique index is what
    // actually holds, and this turns its violation into the same message
    if (err.code === '23505') {
      await discardStoredResume(stored);
      return res.status(409).json({
        error: 'An application for this position already exists with this mobile number.',
      });
    }
    // The resume is already stored at this point - do not leave it orphaned
    await discardStoredResume(stored);
    throw err;
  }

  await logActivity(
    result.rows[0].id,
    'submitted',
    `${opening.position} - ${opening.branch} · via ${attr.source}`
  );

  await invalidate(KEYS.stats);
  res.status(200).json({ success: true, message: 'Application submitted.' });
};

function buildFilters(query, user) {
  const clauses = [];
  const params = [];

  if (query.search) {
    // `%` and `_` are wildcards - escape so a literal search behaves literally
    const like = `%${escapeLike(str(query.search))}%`;
    clauses.push(
      `(full_name ILIKE ? ESCAPE '\\' OR email ILIKE ? ESCAPE '\\' OR mobile ILIKE ? ESCAPE '\\' OR referral_employee_code ILIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like, like);
  }
  const scope = scopeFor(user);
  // Leads referred to a branch appear in that branch's scope too
  if (scope.branch) {
    clauses.push(
      '((branch = ? AND school_group = ?) OR (referred_branch = ? AND referred_entity = ?))'
    );
    params.push(scope.branch, scope.group, scope.branch, scope.group);
  } else if (scope.group) {
    clauses.push('(school_group = ? OR referred_entity = ?)');
    params.push(scope.group, scope.group);
  } else if (query.school_group) {
    // Comma-separated list -> IN clause (multi-select group filter).
    // A referred lead shows under the receiving entity's filter as well.
    const groups = String(query.school_group)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (groups.length) {
      const marks = groups.map(() => '?').join(',');
      clauses.push(`(school_group IN (${marks}) OR referred_entity IN (${marks}))`);
      params.push(...groups, ...groups);
    }
  }
  if (query.opening_id) {
    const id = validId(query.opening_id);
    clauses.push('opening_id = ?');
    params.push(id);
  }
  if (query.position) {
    clauses.push('position = ?');
    params.push(str(query.position));
  }
  if (query.branch) {
    // A referred lead shows under the receiving branch's filter as well, but
    // only when the referral targets a branch of that name in its own entity -
    // two entities may share a branch name.
    clauses.push(
      `(branch = ? OR (referred_branch = ? AND referred_entity IN (
         SELECT school_group FROM branches WHERE name = ?
       )))`
    );
    const b = str(query.branch);
    params.push(b, b, b);
  }
  // Pipeline status (comma-separated screening_status keys)
  if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length) {
      clauses.push(
        `COALESCE(NULLIF(screening_status, ''), 'new') IN (${statuses.map(() => '?').join(',')})`
      );
      params.push(...statuses);
    }
  }
  // Referral handoff: '1' = referred to another branch, '0' = not referred
  if (query.referred === '1') {
    clauses.push("COALESCE(referred_branch, '') <> ''");
  } else if (query.referred === '0') {
    clauses.push("COALESCE(referred_branch, '') = ''");
  }
  // Traffic source (comma-separated labels, blank source counts as Website)
  if (query.source) {
    const sources = String(query.source)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (sources.length) {
      clauses.push(
        `COALESCE(NULLIF(source, ''), 'Website') IN (${sources.map(() => '?').join(',')})`
      );
      params.push(...sources);
    }
  }
  // Candidates that reached at least one interview round
  if (query.in_interview === '1') {
    clauses.push(HAS_REAL_ROUND);
  }
  // Invalid dates would reach PostgreSQL and raise a 500 - ignore them instead
  if (query.from && isValidDate(query.from)) {
    clauses.push(`(created_at AT TIME ZONE ?)::date >= ?::date`);
    params.push(APP_TZ, query.from);
  }
  if (query.to && isValidDate(query.to)) {
    clauses.push(`(created_at AT TIME ZONE ?)::date <= ?::date`);
    params.push(APP_TZ, query.to);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

// Sortable columns, mapped to safe SQL expressions (never interpolate raw input)
const SORT_COLUMNS = {
  created_at: 'created_at',
  last_activity: 'COALESCE(last_activity_at, created_at)',
};

function orderByClause(query) {
  const column = SORT_COLUMNS[query.sort] || SORT_COLUMNS.created_at;
  const direction = String(query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${column} ${direction}, id ${direction}`;
}

exports.list = async (req, res) => {
  const { where, params } = buildFilters(req.query, req.user);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = (
    await db.get(`SELECT COUNT(*) AS count FROM applications ${where}`, ...params)
  ).count;

  const applications = await db.all(
    `SELECT * FROM applications ${where} ${orderByClause(req.query)} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );

  res.json({ applications, total, page, limit, totalPages: Math.ceil(total / limit) });
};

// Single application, enforcing the caller's branch/group scope
// Returns the application if it exists and is inside the user's scope, else null
async function findScopedApplication(req) {
  const application = await db.get('SELECT * FROM applications WHERE id = ?', validId(req.params.id));
  if (!application) return null;

  const scope = scopeFor(req.user);
  // Leads referred to a branch are in that branch's scope too
  let inScope = true;
  if (scope.branch) {
    inScope =
      (application.branch === scope.branch && application.school_group === scope.group) ||
      (application.referred_branch === scope.branch && application.referred_entity === scope.group);
  } else if (scope.group) {
    inScope =
      application.school_group === scope.group || application.referred_entity === scope.group;
  }
  return inScope ? application : null;
}

// Streams a candidate's resume to an admin whose scope covers them.
//
// Resumes are not published: Drive files are private and the local fallback is
// not reachable from the public API. This is the only way to read one, so every
// access is authenticated, scope-checked and recorded on the applicant's
// timeline.
exports.getResume = async (req, res, next) => {
  const application = await findScopedApplication(req);
  if (!application) return res.status(404).json({ error: 'Application not found.' });
  if (!application.resume_link && !application.resume_file_id) {
    return res.status(404).json({ error: 'No resume was uploaded with this application.' });
  }

  // `inline` renders in the preview pane; `attachment` forces a download
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  const safeName = `${String(application.full_name || 'resume').replace(/[^\w\- ]+/g, '_')}`;

  const send = (mimeType, size) => {
    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A resume is candidate data, never a page: sandbox it and keep it out of
    // shared caches and proxies
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const ext = mimeType.includes('word') ? '.docx' : mimeType.includes('pdf') ? '.pdf' : '';
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}${ext}"`);
    if (size) res.setHeader('Content-Length', size);
  };

  try {
    if (application.resume_file_id) {
      const file = await openDriveFile(application.resume_file_id);
      send(file.mimeType, file.size);
      file.stream.on('error', (err) => {
        console.error('Resume stream failed:', err.message);
        if (!res.headersSent) res.status(502).json({ error: 'Could not read the resume.' });
        else res.destroy();
      });
      file.stream.pipe(res);
      return;
    }

    const localPath = localResumePath(application.resume_link);
    if (!localPath) {
      return res.status(404).json({ error: 'The stored resume could not be found.' });
    }
    const ext = path.extname(localPath).toLowerCase();
    send(
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.doc'
          ? 'application/msword'
          : ext === '.docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/octet-stream'
    );
    fs.createReadStream(localPath).pipe(res);
  } catch (err) {
    if (err.code === 404 || err.response?.status === 404) {
      return res.status(404).json({ error: 'The stored resume could not be found.' });
    }
    return next(err);
  }
};

function logActivity(applicationId, action, detail, actorId) {
  return db.run(
    'INSERT INTO application_activity (application_id, action, detail, actor_id) VALUES (?, ?, ?, ?)',
    applicationId,
    action,
    detail,
    actorId || null
  );
}

function loadActivity(applicationId) {
  return db.all(
    `SELECT ac.*, u.name AS actor_name
     FROM application_activity ac
     LEFT JOIN users u ON u.id = ac.actor_id
     WHERE ac.application_id = ?
     ORDER BY ac.created_at, ac.id`,
    applicationId
  );
}

const stageLabelOf = async (key) =>
  (await db.get("SELECT label FROM flow_options WHERE type = 'profile_stage' AND key = ?", key))
    ?.label ||
  key ||
  '';

function loadRounds(applicationId) {
  return db.all(
    `SELECT r.*, au.name AS assigned_to_name, uu.name AS updated_by_name
     FROM interview_rounds r
     LEFT JOIN users au ON au.id = r.assigned_to
     LEFT JOIN users uu ON uu.id = r.updated_by
     WHERE r.application_id = ?
     ORDER BY r.round_no`,
    applicationId
  );
}

exports.getOne = async (req, res) => {
  const application = await findScopedApplication(req);
  if (!application) return res.status(404).json({ error: 'Application not found.' });
  res.json({
    application,
    rounds: await loadRounds(application.id),
    activity: await loadActivity(application.id),
  });
};

// ---- Hiring pipeline -------------------------------------------------------

// "In interview" means an interview actually happened. Answering "next round:
// yes" creates the round row up front to carry the assignment, so a row on its
// own is not evidence of one - it must have been filled in.
const hasRealRound = (alias = 'applications') => `EXISTS (
  SELECT 1 FROM interview_rounds r
  WHERE r.application_id = ${alias}.id
    AND (r.feedback <> '' OR r.status <> 'in_process')
)`;
const HAS_REAL_ROUND = hasRealRound();

// Built-ins stay valid even if the configured list is edited later.
// `current` is the value already on the record: a stage that was deactivated
// after it was assigned must stay saveable, or every later save of that
// applicant fails until someone notices and picks a different status.
const FALLBACK_STATUSES = ['new', 'in_process', 'shortlisted', 'selected', 'hold', 'not_selected'];
const isValidStage = async (status, current) =>
  FALLBACK_STATUSES.includes(status) ||
  (current && status === current) ||
  (await activeStageKeys()).includes(status);
const MAX_ROUNDS = 2;

// Interviewer choices for the "Assign to" dropdown, narrowed to the caller's
// own scope - the full staff directory is not theirs to enumerate
async function assigneesFor(user) {
  const scope = scopeFor(user);
  if (scope.branchId) {
    return db.all(
      'SELECT id, name FROM users WHERE is_active = 1 AND branch_id = ? ORDER BY name',
      scope.branchId
    );
  }
  if (scope.group) {
    return db.all(
      'SELECT id, name FROM users WHERE is_active = 1 AND school_group = ? ORDER BY name',
      scope.group
    );
  }
  return db.all('SELECT id, name FROM users WHERE is_active = 1 ORDER BY name');
}

exports.listAssignees = async (req, res) => {
  res.json({ assignees: await assigneesFor(req.user) });
};

exports.updateScreening = async (req, res) => {
  const application = await findScopedApplication(req);
  if (!application) return res.status(404).json({ error: 'Application not found.' });

  const body = req.body || {};
  const status = (body.status || '').trim();
  if (status && !(await isValidStage(status, application.screening_status))) {
    return res.status(400).json({ error: 'Invalid profile status.' });
  }

  // Optional handoff to another branch - entity and branch must exist together
  const referredEntity = (body.referred_entity || '').trim();
  const referredBranch = (body.referred_branch || '').trim();
  const isReferred = !!(referredEntity && referredBranch);
  if ((referredEntity || referredBranch) && !isReferred) {
    return res.status(400).json({ error: 'Select both an entity and a branch to refer this lead.' });
  }
  if (isReferred) {
    const known = await db.get(
      'SELECT id FROM branches WHERE school_group = ? AND name = ? AND is_active = 1',
      referredEntity,
      referredBranch
    );
    if (!known) {
      return res.status(400).json({ error: 'Select an active branch of the chosen entity.' });
    }
    // Handing a lead to the branch it already sits in is a no-op
    if (referredEntity === application.school_group && referredBranch === application.branch) {
      return res
        .status(400)
        .json({ error: 'This lead already belongs to that branch. Choose a different one.' });
    }
  }

  // The receiving branch runs its own interviews, so a referred lead can still
  // advance - previously this was forced off, leaving referred leads with no
  // way forward except removing the referral (which revoked the new branch's
  // own access to them).
  const nextRound = toBool(body.next_round) ? 1 : 0;

  // Only the fields actually present are written. A blind full overwrite meant
  // two admins with the profile open silently clobbered each other, and any
  // partial API call wiped every column it happened to omit.
  const keep = (key, value) => (body[key] === undefined ? undefined : value);
  const updates = {
    screening_experience: keep('experience', str(body.experience).slice(0, 60)),
    screening_current_salary: keep('current_salary', str(body.current_salary).slice(0, 60)),
    screening_expected_salary: keep('expected_salary', str(body.expected_salary).slice(0, 60)),
    screening_comments: keep('comments', str(body.comments).slice(0, 4000)),
    screening_location: keep('location', str(body.location).slice(0, 120)),
    screening_relocate: keep('relocate', toBool(body.relocate) ? 1 : 0),
    screening_status: keep('status', status),
    screening_next_round: keep('next_round', nextRound),
    // The referral is a pair, so both columns move together or neither does
    referred_entity: body.referred_entity === undefined ? undefined : referredEntity,
    referred_branch: body.referred_entity === undefined ? undefined : referredBranch,
  };

  const columns = Object.keys(updates).filter((k) => updates[k] !== undefined);
  if (columns.length) {
    await db.run(
      `UPDATE applications SET ${columns.map((c) => `${c} = ?`).join(', ')},
        last_activity_at = now()
       WHERE id = ?`,
      ...columns.map((c) => updates[c]),
      application.id
    );
  } else {
    await db.run('UPDATE applications SET last_activity_at = now() WHERE id = ?', application.id);
  }

  const gateChanged = body.next_round !== undefined;
  if (gateChanged && nextRound) {
    // "Next Interview Round: Yes" assigns the interviewer for round 1 right away
    if (body.next_assigned_name !== undefined) {
      await upsertRoundAssignee(application.id, 1, body.next_assigned_name, req.user.id);
    }
  } else if (gateChanged) {
    // Answering No closes the whole interview branch. Rounds nobody filled in
    // are removed so they stop counting towards "in interview"; rounds with
    // real feedback are kept and their own gates closed, so a later Yes cannot
    // resurrect a chain the admin just ended.
    await db.run(
      `DELETE FROM interview_rounds
       WHERE application_id = ? AND feedback = '' AND status = 'in_process'`,
      application.id
    );
    await db.run(
      'UPDATE interview_rounds SET next_round = 0, updated_at = now() WHERE application_id = ?',
      application.id
    );
  }

  const parts = [`Status: ${(await stageLabelOf(status)) || '—'}`];
  if (isReferred) parts.push(`Referred to ${referredBranch} (${referredEntity})`);
  // Revoking a handoff is as significant as making one - record it
  else if (application.referred_branch) {
    parts.push(`Referral to ${application.referred_branch} removed`);
  }
  if (nextRound) {
    const who = (body.next_assigned_name || '').trim();
    parts.push(`Next round: Yes${who ? ` (assigned to ${who})` : ''}`);
  }
  await logActivity(application.id, 'screening', parts.join(' · '), req.user.id);

  await invalidate(KEYS.stats);
  const updated = await db.get('SELECT * FROM applications WHERE id = ?', application.id);
  res.json({
    application: updated,
    rounds: await loadRounds(application.id),
    activity: await loadActivity(application.id),
  });
};

// Sets who takes a round without touching its feedback/status
function upsertRoundAssignee(applicationId, roundNo, name, userId) {
  return db.run(
    `INSERT INTO interview_rounds (application_id, round_no, assigned_name, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (application_id, round_no) DO UPDATE SET
       assigned_name = EXCLUDED.assigned_name,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    applicationId,
    roundNo,
    String(name || '').trim().slice(0, 120),
    userId
  );
}

exports.updateRound = async (req, res) => {
  const application = await findScopedApplication(req);
  if (!application) return res.status(404).json({ error: 'Application not found.' });

  const roundNo = Number(req.params.roundNo);
  if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > MAX_ROUNDS) {
    return res.status(400).json({ error: 'Invalid interview round.' });
  }

  // A round only opens when every stage before it answered "Next Interview
  // Round: Yes". Checking one link back is not enough - closing the screening
  // gate would leave round 2 writable while round 1 was correctly refused.
  if (!application.screening_next_round) {
    return res.status(400).json({ error: 'Enable "Next Interview Round" in screening first.' });
  }
  for (let previous = 1; previous < roundNo; previous += 1) {
    const prev = await db.get(
      'SELECT next_round FROM interview_rounds WHERE application_id = ? AND round_no = ?',
      application.id,
      previous
    );
    if (!prev || !prev.next_round) {
      return res
        .status(400)
        .json({ error: `Enable "Next Interview Round" in round ${previous} first.` });
    }
  }

  const body = req.body || {};
  const status = (body.status || 'in_process').trim();

  // The round's own assignee was set by the previous stage - preserve both the
  // name and the user link unless this save explicitly replaces them
  const existingRound = await db.get(
    'SELECT assigned_name, assigned_to, status FROM interview_rounds WHERE application_id = ? AND round_no = ?',
    application.id,
    roundNo
  );
  if (!(await isValidStage(status, existingRound?.status))) {
    return res.status(400).json({ error: 'Invalid profile status.' });
  }
  const assignedName =
    body.assigned_name !== undefined
      ? String(body.assigned_name).trim().slice(0, 120)
      : existingRound?.assigned_name || '';

  let assignedTo = existingRound?.assigned_to || null;
  if (body.assigned_to !== undefined) {
    if (!body.assigned_to) {
      assignedTo = null;
    } else {
      // Only interviewers the caller can actually see - otherwise a branch
      // admin assigns rounds to staff in other entities
      const wanted = validId(body.assigned_to);
      const allowed = await assigneesFor(req.user);
      if (!allowed.some((a) => a.id === wanted)) {
        return res.status(400).json({ error: 'Select a valid interviewer.' });
      }
      assignedTo = wanted;
    }
  }

  await db.run(
    `INSERT INTO interview_rounds (application_id, round_no, assigned_to, assigned_name, feedback, status, next_round, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())
     ON CONFLICT (application_id, round_no) DO UPDATE SET
       assigned_to = EXCLUDED.assigned_to,
       assigned_name = EXCLUDED.assigned_name,
       feedback = EXCLUDED.feedback,
       status = EXCLUDED.status,
       next_round = EXCLUDED.next_round,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    application.id,
    roundNo,
    assignedTo,
    assignedName,
    (body.feedback || '').trim(),
    status,
    roundNo < MAX_ROUNDS && toBool(body.next_round) ? 1 : 0,
    req.user.id
  );

  if (roundNo < MAX_ROUNDS && toBool(body.next_round)) {
    // Answering Yes here assigns the interviewer for the following round
    if (body.next_assigned_name !== undefined) {
      await upsertRoundAssignee(application.id, roundNo + 1, body.next_assigned_name, req.user.id);
    }
  } else if (roundNo < MAX_ROUNDS) {
    // Answering No removes a placeholder round that was never filled in, so it
    // stops counting towards "in interview"
    await db.run(
      `DELETE FROM interview_rounds
       WHERE application_id = ? AND round_no = ? AND feedback = '' AND status = 'in_process'`,
      application.id,
      roundNo + 1
    );
  }

  // Starting interviews advances the application's stage; a decision already
  // recorded in screening (hold, not selected, ...) is left untouched
  const advance = application.screening_status === 'shortlisted' ? 'in_interview' : null;
  if (advance) {
    await db.run(
      'UPDATE applications SET last_activity_at = now(), screening_status = ? WHERE id = ?',
      advance,
      application.id
    );
  } else {
    await db.run('UPDATE applications SET last_activity_at = now() WHERE id = ?', application.id);
  }

  const parts = [`Round ${roundNo}`, `Status: ${(await stageLabelOf(status)) || '—'}`];
  // Must use the coerced value, not the raw body: the string "false" is truthy
  // in JavaScript, so the timeline claimed "Next round: Yes" for rounds the
  // database had correctly recorded as No
  if (roundNo < MAX_ROUNDS && toBool(body.next_round)) {
    const who = (body.next_assigned_name || '').trim();
    parts.push(`Next round: Yes${who ? ` (assigned to ${who})` : ''}`);
  }
  await logActivity(application.id, 'round', parts.join(' · '), req.user.id);

  await invalidate(KEYS.stats);
  const updatedApp = await db.get('SELECT * FROM applications WHERE id = ?', application.id);
  res.json({
    application: updatedApp,
    rounds: await loadRounds(application.id),
    activity: await loadActivity(application.id),
  });
};

exports.updateSuggestion = async (req, res) => {
  const application = await findScopedApplication(req);
  if (!application) return res.status(404).json({ error: 'Application not found.' });

  const suggested = str((req.body || {}).suggested_role).slice(0, 120);
  // The UI offers only configured roles; the server must agree, or arbitrary
  // text lands in the applicant record and in the CSV export
  if (suggested) {
    const known = await db.get(
      `SELECT 1 FROM flow_options
       WHERE type = 'suggested_role' AND is_active = 1 AND LOWER(label) = LOWER(?)`,
      suggested
    );
    if (!known) {
      return res
        .status(400)
        .json({ error: 'Choose a role from the list configured under Flow Configuration.' });
    }
  }
  await db.run(
    'UPDATE applications SET suggested_role = ?, last_activity_at = now() WHERE id = ?',
    suggested,
    application.id
  );

  await logActivity(
    application.id,
    'suggestion',
    suggested ? `Suggested role: ${suggested}` : 'Suggestion cleared',
    req.user.id
  );

  const updated = await db.get('SELECT * FROM applications WHERE id = ?', application.id);
  res.json({ application: updated, activity: await loadActivity(application.id) });
};

// Scoped headline numbers for the admin dashboard (unfiltered except by user scope)
// Headline numbers for the dashboard and the sidebar badge.
//
// This used to issue nine separate full-table aggregates, and AdminLayout calls
// it on every navigation - so it ran nine scans per page view. It is now one
// query for the counters and one for the trend, cached briefly per scope.
//
// Cached PER SCOPE, never under one key: a branch admin's totals are not the
// same numbers as an unscoped admin's, and serving one to the other would leak
// the size of data they cannot see.
exports.stats = async (req, res) => {
  const scope = scopeFor(req.user);
  const scopeKey = scope.branchId ? `b${scope.branchId}` : scope.group ? `g${scope.group}` : 'all';

  const payload = await remember(`${KEYS.stats}${scopeKey}`, async () => {
    const { where, params } = buildFilters({}, req.user);

    // All day maths runs in the configured timezone
    const localDate = `(created_at AT TIME ZONE '${APP_TZ}')::date`;
    const todayLocal = `(now() AT TIME ZONE '${APP_TZ}')::date`;

    // One pass over the filtered set produces every counter and every breakdown
    const summary = await db.get(
      `WITH base AS (SELECT * FROM applications ${where})
       SELECT
         (SELECT COUNT(*) FROM base) AS total,
         (SELECT COUNT(*) FROM base WHERE ${localDate} = ${todayLocal}) AS today,
         (SELECT COUNT(*) FROM base WHERE ${localDate} >= ${todayLocal} - 6) AS week,
         (SELECT COUNT(*) FROM base
           WHERE ${localDate} >= ${todayLocal} - 13
             AND ${localDate} <  ${todayLocal} - 6) AS prev_week,
         (SELECT COUNT(*) FROM base WHERE COALESCE(referred_branch, '') <> '') AS referred,
         (SELECT COUNT(*) FROM base WHERE ${hasRealRound('base')}) AS in_interview,
         (SELECT COALESCE(jsonb_object_agg(school_group, c), '{}'::jsonb)
            FROM (SELECT school_group, COUNT(*) AS c FROM base GROUP BY 1) g) AS by_group,
         (SELECT COALESCE(jsonb_object_agg(stage, c), '{}'::jsonb)
            FROM (SELECT COALESCE(NULLIF(screening_status, ''), 'new') AS stage,
                         COUNT(*) AS c FROM base GROUP BY 1) st) AS by_stage,
         (SELECT COALESCE(jsonb_object_agg(source, c), '{}'::jsonb)
            FROM (SELECT COALESCE(NULLIF(source, ''), 'Website') AS source,
                         COUNT(*) AS c FROM base GROUP BY 1) sr) AS by_source`,
      ...params
    );

    // Daily submissions for the last 90 days (sparse; missing days have no row)
    const trendWhere = where
      ? `${where} AND ${localDate} >= ${todayLocal} - 89`
      : `WHERE ${localDate} >= ${todayLocal} - 89`;
    const byDay = await db.all(
      `SELECT ${localDate} AS day, COUNT(*) AS count
       FROM applications ${trendWhere} GROUP BY 1 ORDER BY 1`,
      ...params
    );

    return {
      total: Number(summary.total),
      today: Number(summary.today),
      week: Number(summary.week),
      prevWeek: Number(summary.prev_week),
      byDay,
      byGroup: summary.by_group || {},
      byStage: summary.by_stage || {},
      bySource: summary.by_source || {},
      referred: Number(summary.referred),
      inInterview: Number(summary.in_interview),
    };
  });

  res.json(payload);
};

// ---- CSV export, gated by a super-admin approval code ----------------------

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;

const maskEmail = (email) => {
  const [name, domain] = String(email).split('@');
  if (!domain) return email;
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
};

// Every active super admin approves exports
async function superAdminEmails() {
  return (
    await db.all(
      `SELECT DISTINCT u.email
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = 1
         AND (u.role = 'super_admin' OR r.permissions LIKE '%"*"%')`
    )
  )
    .map((r) => r.email)
    .filter(Boolean);
}

// A stable fingerprint of the filters an export covers, so the code a super
// admin approves cannot be redeemed against a different (wider) selection.
// Must list EVERY key buildFilters reads. A filter missing here is invisible to
// the comparison, so a code approved for a narrow selection ("0 applications")
// redeems against the unfiltered set.
const FILTER_KEYS = [
  'search',
  'school_group',
  'opening_id',
  'position',
  'branch',
  'status',
  'referred',
  'source',
  'in_interview',
  'from',
  'to',
];
const filterKeyOf = (query) =>
  JSON.stringify(
    FILTER_KEYS.reduce((acc, k) => {
      if (query[k] !== undefined && query[k] !== '') acc[k] = String(query[k]);
      return acc;
    }, {})
  );

function scopeDescription(user, query) {
  const scope = scopeFor(user);
  if (scope.branch) return `${scope.branch} (${scope.group})`;
  if (scope.group) return scope.group;
  if (query.school_group) return `groups: ${query.school_group}`;
  return 'all school groups';
}

exports.requestExportOtp = async (req, res) => {
  const recipients = await superAdminEmails();
  if (!recipients.length) {
    return res
      .status(503)
      .json({ error: 'No active super admin is configured to approve exports.' });
  }

  // Throttle repeat requests so the approver is not spammed. Used codes count
  // too - otherwise a completed export resets the window immediately.
  const recent = await db.get(
    `SELECT created_at FROM export_otps
     WHERE requested_by = ?
       AND created_at > now() - make_interval(secs => ?)
     ORDER BY id DESC LIMIT 1`,
    req.user.id,
    OTP_RESEND_SECONDS
  );
  if (recent) {
    return res.status(429).json({ error: `Please wait a minute before requesting another code.` });
  }

  const { where, params } = buildFilters(req.query, req.user);
  const rowCount = (
    await db.get(`SELECT COUNT(*) AS count FROM applications ${where}`, ...params)
  ).count;

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const sent = await sendExportOtpEmail({
    recipients,
    code,
    requestedBy: req.user.name,
    requestedByEmail: req.user.email,
    scopeText: scopeDescription(req.user, req.query),
    rowCount,
    minutes: OTP_TTL_MINUTES,
  });

  if (!sent.length) {
    return res.status(502).json({
      error: 'Could not email the approval code. Check the mail configuration and try again.',
    });
  }

  // Older unused codes for this user are void once a new one is issued
  await db.run(
    'UPDATE export_otps SET used_at = now() WHERE requested_by = ? AND used_at IS NULL',
    req.user.id
  );

  await db.run(
    `INSERT INTO export_otps (code_hash, requested_by, sent_to, filter_key, expires_at)
     VALUES (?, ?, ?, ?, now() + make_interval(mins => ?))`,
    bcrypt.hashSync(code, 10),
    req.user.id,
    sent.join(', '),
    filterKeyOf(req.query),
    OTP_TTL_MINUTES
  );

  res.json({
    sent_to: sent.map(maskEmail),
    expires_in_minutes: OTP_TTL_MINUTES,
    rows: rowCount,
  });
};

// Consumes the caller's pending code; returns null when it is valid
async function verifyExportOtp(user, code, filterKey) {
  if (!/^\d{6}$/.test(String(code || ''))) return 'Enter the 6-digit approval code.';

  const otp = await db.get(
    `SELECT * FROM export_otps
     WHERE requested_by = ? AND used_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    user.id
  );
  if (!otp) return 'Request an approval code before exporting.';

  if (new Date(otp.expires_at) < new Date()) {
    await db.run('UPDATE export_otps SET used_at = now() WHERE id = ?', otp.id);
    return 'That code has expired. Request a new one.';
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await db.run('UPDATE export_otps SET used_at = now() WHERE id = ?', otp.id);
    return 'Too many incorrect attempts. Request a new code.';
  }
  if (!bcrypt.compareSync(String(code), otp.code_hash)) {
    await db.run('UPDATE export_otps SET attempts = attempts + 1 WHERE id = ?', otp.id);
    const left = OTP_MAX_ATTEMPTS - (otp.attempts + 1);
    return left > 0
      ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
      : 'Too many incorrect attempts. Request a new code.';
  }

  // The download must cover exactly the selection that was approved
  if ((otp.filter_key || '') !== filterKey) {
    return 'These filters differ from the ones that were approved. Request a new code.';
  }

  // Single use
  await db.run('UPDATE export_otps SET used_at = now() WHERE id = ?', otp.id);
  return null;
}

// Columns, in the order they appear in the file
const EXPORT_COLUMNS = [
  ['id', 'ID'],
  ['full_name', 'Full Name'],
  ['email', 'Email'],
  ['mobile', 'Mobile'],
  ['position', 'Position'],
  ['branch', 'Branch'],
  ['school_group', 'School Group'],
  ['source', 'Source'],
  ['utm_source', 'UTM Source'],
  ['utm_medium', 'UTM Medium'],
  ['utm_campaign', 'UTM Campaign'],
  ['experience_years', 'Years of Experience'],
  ['current_company', 'Currently Working In'],
  ['profile_status', 'Profile Status'],
  ['screening_current_salary', 'Current Salary'],
  ['screening_expected_salary', 'Expected Salary'],
  ['screening_location', 'Current Location'],
  ['willing_to_relocate', 'Willing to Relocate'],
  ['screening_comments', 'Screening Comments'],
  ['interview_rounds', 'Interview Rounds'],
  ['last_round_status', 'Latest Round Status'],
  ['last_round_assigned', 'Latest Round Assigned To'],
  ['suggested_role', 'Suggested Role'],
  ['referred_entity', 'Referred To Entity'],
  ['referred_branch', 'Referred To Branch'],
  ['referral_employee_code', 'Referral Employee ID'],
  ['referral_employee_name', 'Referral Employee Name'],
  ['referral_employee_branch', 'Referral Department'],
  ['referral_employee_contact', 'Referral Mobile'],
  ['resume_link', 'Resume Link'],
  ['created_at', 'Submitted At (UTC)'],
  ['last_activity_at', 'Last Activity (UTC)'],
];

// How many rows are read from the cursor at a time. Small enough that memory
// stays flat, large enough that the per-batch round trip is not the cost.
const EXPORT_BATCH = Number(process.env.EXPORT_BATCH_SIZE || 500);

// RFC 4180 line terminator, which is what spreadsheet apps expect
const CRLF = String.fromCharCode(13, 10);

// Streams the export instead of building it in memory.
//
// The previous version loaded every matching row, every interview round and
// every formatted cell before sending a byte, and capped the result at 20,000
// rows - so a larger export silently returned a truncated file that looked
// complete. It now reads through a server-side cursor and writes each batch
// straight to the response: constant memory, no cap, nothing lost.
//
// The cursor lives inside one transaction, which is also what makes it safe
// through a transaction-mode connection pooler.
exports.exportCsv = async (req, res) => {
  const otpError = await verifyExportOtp(req.user, req.query.otp, filterKeyOf(req.query));
  if (otpError) return res.status(403).json({ error: otpError });

  const { where, params } = buildFilters(req.query, req.user);

  // Stage labels are a small fixed set - read once, not per row
  const stageLabels = new Map(
    (await db.all("SELECT key, label FROM flow_options WHERE type = 'profile_stage'")).map((s) => [
      s.key,
      s.label,
    ])
  );
  const labelFor = (key) => (key ? stageLabels.get(key) || key : '');

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="applications-${stamp}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  // Candidate data: never let a proxy hold on to it
  res.write(csvHeader(EXPORT_COLUMNS) + CRLF);

  const client = await db.pool.connect();
  let closed = false;
  // If the browser goes away mid-download, stop reading rather than finishing
  // a file nobody is receiving
  res.on('close', () => {
    closed = true;
  });

  try {
    await client.query('BEGIN');
    await client.query(
      `DECLARE export_cursor NO SCROLL CURSOR FOR
       SELECT * FROM applications ${where} ${orderByClause(req.query)}`,
      params
    );

    for (;;) {
      if (closed) break;
      const batch = await client.query(`FETCH ${EXPORT_BATCH} FROM export_cursor`);
      if (!batch.rows.length) break;

      // Interview rounds for this batch only - one query per batch, not per row
      const ids = batch.rows.map((r) => r.id);
      const roundsById = new Map();
      const rounds = await client.query(
        `SELECT r.application_id, r.round_no, r.status, r.assigned_name, u.name AS assigned_to_name
         FROM interview_rounds r
         LEFT JOIN users u ON u.id = r.assigned_to
         WHERE r.application_id = ANY($1::int[])
         ORDER BY r.application_id, r.round_no`,
        [ids]
      );
      for (const round of rounds.rows) {
        if (!roundsById.has(round.application_id)) roundsById.set(round.application_id, []);
        roundsById.get(round.application_id).push(round);
      }

      let chunk = '';
      for (const r of batch.rows) {
        const rs = roundsById.get(r.id) || [];
        const last = rs[rs.length - 1];
        chunk +=
          csvRow(
            {
              ...r,
              // Blank means Website everywhere else in the app; the export used
              // to say nothing, so one record was counted two different ways
              source: r.source || 'Website',
              profile_status: labelFor(r.screening_status || 'new'),
              willing_to_relocate: r.screening_relocate ? 'Yes' : 'No',
              interview_rounds: rs.length,
              last_round_status: last ? labelFor(last.status) : '',
              last_round_assigned: last ? last.assigned_name || last.assigned_to_name || '' : '',
            },
            EXPORT_COLUMNS
          ) + CRLF;
      }

      // Respect backpressure: if the socket buffer is full, wait for it to
      // drain before reading the next batch
      if (!res.write(chunk)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }

    await client.query('CLOSE export_cursor');
    await client.query('COMMIT');
    res.end();
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is already broken
    }
    console.error('CSV export failed:', err.message);
    // Headers are already sent, so the only honest signal is an aborted
    // download rather than a file that looks complete
    res.destroy(err);
  } finally {
    client.release();
  }
};
