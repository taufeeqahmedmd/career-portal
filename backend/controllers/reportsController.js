const db = require('../db');
const { scopeFor } = require('../utils/scope');
const { can } = require('../utils/permissions');
const { escapeCell } = require('../utils/csv');

// One read-only snapshot of the whole instance: who can get in, what is
// configured, what is published, and what has come back.
//
// It is deliberately a single endpoint. Every section is a small aggregate and
// the page shows them together; six round trips would only add latency and six
// chances for the numbers on screen to disagree with each other.
//
// Everything is scoped: an entity or branch admin sees their own slice, never
// the group's. The counts an unrestricted admin sees are the totals.

const APP_TZ = process.env.APP_TIMEZONE || 'UTC';

// Applications and openings both carry school_group/branch, so one pair of
// clauses covers them - `alias` is the table they belong to.
function scopeClause(scope, alias = '') {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  if (scope.branch) {
    return { sql: `${col('school_group')} = ? AND ${col('branch')} = ?`, params: [scope.group, scope.branch] };
  }
  if (scope.group) {
    return { sql: `${col('school_group')} = ?`, params: [scope.group] };
  }
  return { sql: '', params: [] };
}

const whereFrom = (clause) => (clause.sql ? `WHERE ${clause.sql}` : '');

async function buildReport(req) {
  const scope = scopeFor(req.user);
  // How far back the activity feed and the "in this period" counters look
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);

  const appScope = scopeClause(scope);
  const appWhere = whereFrom(appScope);
  const localDate = `(created_at AT TIME ZONE '${APP_TZ}')::date`;
  const todayLocal = `(now() AT TIME ZONE '${APP_TZ}')::date`;

  // ---- Users ---------------------------------------------------------------
  // Mirrors the scoping of the users page: a scoped admin sees the accounts in
  // their own entity or branch and nothing above them.
  const userClauses = [];
  const userParams = [];
  if (scope.branchId) {
    userClauses.push('u.branch_id = ?');
    userParams.push(scope.branchId);
  } else if (scope.group) {
    userClauses.push('u.school_group = ?');
    userParams.push(scope.group);
  }
  const userWhere = userClauses.length ? `WHERE ${userClauses.join(' AND ')}` : '';

  const users = await db.all(
    `SELECT u.id, u.name, u.email, u.is_active, u.last_login_at, u.created_at,
            u.totp_enabled, u.must_change_password, u.school_group,
            b.name AS branch_name, r.name AS role_name
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN roles r ON r.id = u.role_id
       ${userWhere}
       ORDER BY u.last_login_at DESC NULLS LAST, u.name`,
    ...userParams
  );

  const userSummary = {
    total: users.length,
    active: users.filter((u) => u.is_active).length,
    inactive: users.filter((u) => !u.is_active).length,
    // A live account nobody has ever signed in to is either a mistake or a way
    // in that nobody is watching
    never_logged_in: users.filter((u) => u.is_active && !u.last_login_at).length,
    with_2fa: users.filter((u) => u.is_active && u.totp_enabled).length,
    // Still on the shared initial password
    pending_first_login: users.filter((u) => u.is_active && u.must_change_password).length,
    list: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role_name || '—',
      entity: u.school_group || null,
      branch: u.branch_name || null,
      is_active: !!u.is_active,
      totp_enabled: !!u.totp_enabled,
      must_change_password: !!u.must_change_password,
      last_login_at: u.last_login_at,
      created_at: u.created_at,
    })),
  };

  // ---- Entities and their branches ----------------------------------------
  const entityWhere = scope.group ? 'WHERE e.code = ?' : '';
  const entityParams = scope.group ? [scope.group] : [];

  const entities = await db.all(
    `SELECT e.code, e.name, e.color, e.is_active,
            (SELECT COUNT(*) FROM branches b WHERE b.school_group = e.code) AS branches,
            (SELECT COUNT(*) FROM branches b WHERE b.school_group = e.code AND b.is_active = 1) AS active_branches,
            (SELECT COUNT(*) FROM openings o WHERE o.school_group = e.code) AS openings,
            (SELECT COUNT(*) FROM openings o WHERE o.school_group = e.code AND o.is_active = 1) AS active_openings,
            (SELECT COUNT(*) FROM applications a WHERE a.school_group = e.code) AS applications
       FROM entities e
       ${entityWhere}
       ORDER BY e.name`,
    ...entityParams
  );

  // A branch admin's own branch is the only one worth listing
  const branchClauses = [];
  const branchParams = [];
  if (scope.group) {
    branchClauses.push('b.school_group = ?');
    branchParams.push(scope.group);
  }
  if (scope.branchId) {
    branchClauses.push('b.id = ?');
    branchParams.push(scope.branchId);
  }
  const branchWhere = branchClauses.length ? `WHERE ${branchClauses.join(' AND ')}` : '';

  const branches = await db.all(
    `SELECT b.id, b.name, b.school_group, b.is_active,
            (SELECT COUNT(*) FROM openings o
              WHERE o.branch = b.name AND o.school_group = b.school_group AND o.is_active = 1) AS active_openings,
            (SELECT COUNT(*) FROM applications a
              WHERE a.branch = b.name AND a.school_group = b.school_group) AS applications
       FROM branches b
       ${branchWhere}
       ORDER BY b.school_group, b.name`,
    ...branchParams
  );

  // ---- Openings, with what each one has attracted --------------------------
  const openingScope = scopeClause(scope, 'o');
  const openings = await db.all(
    `SELECT o.id, o.position, o.branch, o.school_group, o.category, o.is_active, o.created_at,
            COUNT(a.id) AS applications,
            MAX(a.created_at) AS last_application_at,
            COUNT(a.id) FILTER (
              WHERE (a.created_at AT TIME ZONE '${APP_TZ}')::date >= ${todayLocal} - ${days - 1}
            ) AS applications_in_period
       FROM openings o
       LEFT JOIN applications a ON a.opening_id = o.id
       ${whereFrom(openingScope)}
       GROUP BY o.id
       ORDER BY o.is_active DESC, COUNT(a.id) DESC, o.position`,
    ...openingScope.params
  );

  const openingRows = openings.map((o) => ({
    id: o.id,
    position: o.position,
    branch: o.branch,
    entity: o.school_group,
    category: o.category,
    is_active: !!o.is_active,
    applications: Number(o.applications),
    applications_in_period: Number(o.applications_in_period),
    last_application_at: o.last_application_at,
    created_at: o.created_at,
  }));
  const activeOpenings = openingRows.filter((o) => o.is_active);

  const openingSummary = {
    total: openingRows.length,
    active: activeOpenings.length,
    inactive: openingRows.length - activeOpenings.length,
    // Live vacancies nobody has applied to: the actionable number on this page
    active_without_applications: activeOpenings.filter((o) => o.applications === 0).length,
    applications_to_active: activeOpenings.reduce((sum, o) => sum + o.applications, 0),
    list: openingRows,
  };

  // ---- Applications --------------------------------------------------------
  const appSummary = await db.get(
    `WITH base AS (SELECT * FROM applications ${appWhere})
     SELECT
       (SELECT COUNT(*) FROM base) AS total,
       (SELECT COUNT(*) FROM base WHERE ${localDate} = ${todayLocal}) AS today,
       (SELECT COUNT(*) FROM base WHERE ${localDate} >= ${todayLocal} - 6) AS week,
       (SELECT COUNT(*) FROM base WHERE ${localDate} >= ${todayLocal} - ${days - 1}) AS in_period,
       (SELECT COUNT(*) FROM base WHERE COALESCE(referral_employee_name, '') <> '') AS referred,
       (SELECT COUNT(*) FROM base WHERE COALESCE(referred_branch, '') <> '') AS handed_over,
       (SELECT MAX(created_at) FROM base) AS last_received_at,
       (SELECT COALESCE(jsonb_object_agg(stage, c), '{}'::jsonb)
          FROM (SELECT COALESCE(NULLIF(screening_status, ''), 'new') AS stage, COUNT(*) AS c
                  FROM base GROUP BY 1) s) AS by_stage,
       (SELECT COALESCE(jsonb_object_agg(source, c), '{}'::jsonb)
          FROM (SELECT COALESCE(NULLIF(source, ''), 'Website') AS source, COUNT(*) AS c
                  FROM base GROUP BY 1) s) AS by_source,
       (SELECT COALESCE(jsonb_object_agg(site, c), '{}'::jsonb)
          FROM (SELECT COALESCE(NULLIF(submitted_via, ''), 'Careers portal') AS site, COUNT(*) AS c
                  FROM base GROUP BY 1) s) AS by_site,
       -- The raw campaign tag, before deriveSource() turns it into a label.
       -- Untagged traffic is its own bucket rather than being dropped.
       (SELECT COALESCE(jsonb_object_agg(utm, c), '{}'::jsonb)
          FROM (SELECT COALESCE(NULLIF(utm_source, ''), 'Not tagged') AS utm, COUNT(*) AS c
                  FROM base GROUP BY 1) s) AS by_utm_source,
       (SELECT COALESCE(jsonb_object_agg(campaign, c), '{}'::jsonb)
          FROM (SELECT NULLIF(utm_campaign, '') AS campaign, COUNT(*) AS c
                  FROM base WHERE COALESCE(utm_campaign, '') <> '' GROUP BY 1) s) AS by_campaign,
       (SELECT COALESCE(jsonb_object_agg(school_group, c), '{}'::jsonb)
          FROM (SELECT school_group, COUNT(*) AS c FROM base GROUP BY 1) s) AS by_entity`,
    ...appScope.params
  );

  // Daily intake for the trend, and the equivalent window before it so the
  // headline can carry a change rather than a bare number. Sparse: days with no
  // applications have no row, and the client fills the gaps.
  const trendWhere = appWhere
    ? `${appWhere} AND ${localDate} >= ${todayLocal} - ${days - 1}`
    : `WHERE ${localDate} >= ${todayLocal} - ${days - 1}`;
  const byDay = await db.all(
    `SELECT ${localDate} AS day, COUNT(*) AS count
       FROM applications ${trendWhere} GROUP BY 1 ORDER BY 1`,
    ...appScope.params
  );

  const previousWhere = appWhere
    ? `${appWhere} AND ${localDate} >= ${todayLocal} - ${2 * days - 1} AND ${localDate} < ${todayLocal} - ${days - 1}`
    : `WHERE ${localDate} >= ${todayLocal} - ${2 * days - 1} AND ${localDate} < ${todayLocal} - ${days - 1}`;
  const previous = await db.get(
    `SELECT COUNT(*) AS count FROM applications ${previousWhere}`,
    ...appScope.params
  );

  // Configured stage labels and colours, so the report reads the same words the
  // pipeline does. Stages retired since an application was set to them still
  // have counts, and are reported under their raw key.
  const stageOptions = await db.all(
    `SELECT key, label, color, sort_order FROM flow_options
      WHERE type = 'profile_stage' AND is_active = 1
      ORDER BY sort_order, id`
  );
  const byStage = appSummary.by_stage || {};
  const known = new Set(stageOptions.map((s) => s.key));
  const stages = [
    // 'new' is the implicit stage of an application nobody has touched yet; it
    // is not a configured option, so it would otherwise be missing entirely
    ...(known.has('new') ? [] : [{ key: 'new', label: 'Awaiting screening', color: '#a8a29e' }]),
    ...stageOptions.map((s) => ({ key: s.key, label: s.label, color: s.color })),
  ].map((s) => ({ ...s, count: Number(byStage[s.key] || 0) }));

  const retiredStages = Object.entries(byStage)
    .filter(([key]) => key !== 'new' && !known.has(key))
    .map(([key, count]) => ({ key, label: key, color: '#d6d3d1', count: Number(count), retired: true }));

  // ---- Who has been working the pipeline ----------------------------------
  // 'submitted' rows are written by the public form and have no actor, so they
  // are excluded: this section is about what the admin team has done.
  const activityScope = scope.branch
    ? { sql: 'AND app.school_group = ? AND app.branch = ?', params: [scope.group, scope.branch] }
    : scope.group
      ? { sql: 'AND app.school_group = ?', params: [scope.group] }
      : { sql: '', params: [] };

  const activityByUser = await db.all(
    `SELECT u.id, u.name, u.email, u.is_active,
            COUNT(*) AS actions,
            MAX(act.created_at) AS last_action_at,
            (ARRAY_AGG(act.action ORDER BY act.created_at DESC))[1] AS last_action,
            (ARRAY_AGG(act.detail ORDER BY act.created_at DESC))[1] AS last_detail
       FROM application_activity act
       JOIN users u ON u.id = act.actor_id
       JOIN applications app ON app.id = act.application_id
      WHERE act.actor_id IS NOT NULL
        AND (act.created_at AT TIME ZONE '${APP_TZ}')::date >= ${todayLocal} - ${days - 1}
        ${activityScope.sql}
      GROUP BY u.id
      ORDER BY MAX(act.created_at) DESC`,
    ...activityScope.params
  );

  const activityTotals = await db.get(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE act.actor_id IS NULL) AS submissions
       FROM application_activity act
       JOIN applications app ON app.id = act.application_id
      WHERE (act.created_at AT TIME ZONE '${APP_TZ}')::date >= ${todayLocal} - ${days - 1}
        ${activityScope.sql}`,
    ...activityScope.params
  );

  return {
    generated_at: new Date().toISOString(),
    period_days: days,
    timezone: APP_TZ,
    scope: {
      entity: scope.group || null,
      branch: scope.branch || null,
      unrestricted: !scope.group && !scope.branch,
    },
    // Only an account that can manage users has any business reading the roster
    users: can(req.user, 'users.manage')
      ? userSummary
      : { restricted: true, total: userSummary.total, active: userSummary.active, list: [] },
    entities: {
      total: entities.length,
      active: entities.filter((e) => e.is_active).length,
      list: entities.map((e) => ({
        code: e.code,
        name: e.name,
        color: e.color,
        is_active: !!e.is_active,
        branches: Number(e.branches),
        active_branches: Number(e.active_branches),
        openings: Number(e.openings),
        active_openings: Number(e.active_openings),
        applications: Number(e.applications),
      })),
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        entity: b.school_group,
        is_active: !!b.is_active,
        active_openings: Number(b.active_openings),
        applications: Number(b.applications),
      })),
    },
    openings: openingSummary,
    applications: {
      total: Number(appSummary.total),
      today: Number(appSummary.today),
      week: Number(appSummary.week),
      in_period: Number(appSummary.in_period),
      previous_period: Number(previous.count),
      by_day: byDay.map((d) => ({ day: d.day, count: Number(d.count) })),
      referred: Number(appSummary.referred),
      handed_over: Number(appSummary.handed_over),
      last_received_at: appSummary.last_received_at,
      stages: [...stages, ...retiredStages],
      by_source: appSummary.by_source || {},
      by_site: appSummary.by_site || {},
      by_utm_source: appSummary.by_utm_source || {},
      by_campaign: appSummary.by_campaign || {},
      by_entity: appSummary.by_entity || {},
    },
    activity: {
      total: Number(activityTotals.total),
      submissions: Number(activityTotals.submissions),
      by_user: activityByUser.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        is_active: !!a.is_active,
        actions: Number(a.actions),
        last_action_at: a.last_action_at,
        last_action: a.last_action,
        last_detail: a.last_detail,
      })),
    },
  };
}

exports.summary = async (req, res) => {
  res.json(await buildReport(req));
};

// The same report as a spreadsheet. One file with a section per block rather
// than several downloads: it is read as a whole, and a single sheet is what
// gets forwarded to a meeting.
exports.exportCsv = async (req, res) => {
  const report = await buildReport(req);
  const lines = [];

  const section = (title) => {
    if (lines.length) lines.push('');
    lines.push(escapeCell(title));
  };
  const row = (...cells) => lines.push(cells.map(escapeCell).join(','));
  const date = (value) => (value ? new Date(value).toISOString() : 'never');

  const scopeLabel = report.scope.branch
    ? `${report.scope.entity} · ${report.scope.branch}`
    : report.scope.entity || 'All entities';

  section('Careers portal report');
  row('Generated (UTC)', report.generated_at);
  row('Scope', scopeLabel);
  row('Period', `Last ${report.period_days} days`);
  row('Timezone', report.timezone);

  section('Users');
  if (report.users.restricted) {
    row('Note', 'The account running this report cannot see the user roster.');
    row('Total', report.users.total);
    row('Active', report.users.active);
  } else {
    row('Total', report.users.total);
    row('Active', report.users.active);
    row('Inactive', report.users.inactive);
    row('Never signed in', report.users.never_logged_in);
    row('Two-factor enabled', report.users.with_2fa);
    row('Still on the initial password', report.users.pending_first_login);
    lines.push('');
    row('Name', 'Email', 'Role', 'Entity', 'Branch', 'Status', '2FA', 'Last login (UTC)');
    report.users.list.forEach((u) =>
      row(
        u.name,
        u.email,
        u.role,
        u.entity || '—',
        u.branch || '—',
        u.is_active ? 'Active' : 'Inactive',
        u.totp_enabled ? 'Yes' : 'No',
        date(u.last_login_at)
      )
    );
  }

  section('Entities');
  row('Entity', 'Code', 'Status', 'Branches', 'Active branches', 'Active openings', 'Applications');
  report.entities.list.forEach((e) =>
    row(
      e.name,
      e.code,
      e.is_active ? 'Active' : 'Inactive',
      e.branches,
      e.active_branches,
      e.active_openings,
      e.applications
    )
  );

  section('Branches');
  row('Branch', 'Entity', 'Status', 'Active openings', 'Applications');
  report.entities.branches.forEach((b) =>
    row(b.name, b.entity, b.is_active ? 'Active' : 'Inactive', b.active_openings, b.applications)
  );

  section('Job openings');
  row('Active', report.openings.active);
  row('Inactive', report.openings.inactive);
  row('Active with no applications', report.openings.active_without_applications);
  lines.push('');
  row(
    'Position',
    'Branch',
    'Entity',
    'Status',
    'Applications',
    `Last ${report.period_days} days`,
    'Most recent application (UTC)'
  );
  report.openings.list.forEach((o) =>
    row(
      o.position,
      o.branch,
      o.entity,
      o.is_active ? 'Active' : 'Closed',
      o.applications,
      o.applications_in_period,
      date(o.last_application_at)
    )
  );

  section('Applications');
  row('Total', report.applications.total);
  row('Today', report.applications.today);
  row('Last 7 days', report.applications.week);
  row(`Last ${report.period_days} days`, report.applications.in_period);
  row('Employee referrals', report.applications.referred);
  row('Handed to another branch', report.applications.handed_over);
  row('Most recent (UTC)', date(report.applications.last_received_at));
  lines.push('');
  row('Stage', 'Applications');
  report.applications.stages.forEach((s) =>
    row(s.retired ? `${s.label} (retired stage)` : s.label, s.count)
  );
  lines.push('');
  row('Submitted via', 'Applications');
  Object.entries(report.applications.by_site).forEach(([site, count]) => row(site, count));

  section(`Pipeline activity — last ${report.period_days} days`);
  row('Actions by the team', report.activity.total - report.activity.submissions);
  row('New applications received', report.activity.submissions);
  lines.push('');
  row('User', 'Email', 'Status', 'Actions', 'Last action', 'Last action at (UTC)');
  report.activity.by_user.forEach((a) =>
    row(
      a.name,
      a.email,
      a.is_active ? 'Active' : 'Inactive',
      a.actions,
      a.last_action || '—',
      date(a.last_action_at)
    )
  );

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="careers-report-${stamp}.csv"`);
  // BOM so Excel opens UTF-8 names correctly
  res.send('﻿' + lines.join('\r\n') + '\r\n');
};
