import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { notify } from "../../components/Toaster";
import { getReport, exportReportCsv, getEntities } from "../../services/api";
import {
  card,
  btnDark,
  btnGhost,
  thBase,
  PageHeader,
  GroupBadge,
  StatusBadge,
  registerEntities,
  groupMeta,
  parseDbDate,
  formatDate,
} from "../ui";

// ---------------------------------------------------------------------------
// Helpers

const RANGES = [7, 30, 90];

const timeAgo = (value) => {
  const d = parseDbDate(value);
  if (!d) return "never";
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
};

const num = (n) => (n ?? 0).toLocaleString("en-IN");

const Stat = ({ label, value, sub, tone = "ink", to }) => {
  const body = (
    <div className={`${card} p-4 h-full`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88]">{label}</p>
      <p
        className={`font-poppins text-2xl font-semibold mt-1 ${
          tone === "accent" ? "text-[#a81724]" : "text-[#2a2426]"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-[#7d7679] mt-1">{sub}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block hover:opacity-90 transition-opacity">
      {body}
    </Link>
  ) : (
    body
  );
};

const Section = ({ title, sub, right, children }) => (
  <section className="mt-8">
    <div className="flex items-end justify-between gap-4 mb-3">
      <div>
        <h3 className="font-poppins text-lg font-semibold text-[#2a2426]">{title}</h3>
        {sub && <p className="text-xs text-[#7d7679] mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const Table = ({ head, children, empty }) => (
  <div className={`${card} overflow-hidden`}>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#e7e4e1]">
            {head.map((h) => (
              <th key={h.key || h} className={`${thBase} ${h.align === "right" ? "text-right" : ""}`}>
                {h.label || h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0edea]">{children}</tbody>
      </table>
    </div>
    {empty}
  </div>
);

const Td = ({ children, right, muted, className = "" }) => (
  <td
    className={`px-4 py-3 ${right ? "text-right tabular-nums" : ""} ${
      muted ? "text-[#7d7679]" : "text-[#2a2426]"
    } ${className}`}
  >
    {children}
  </td>
);

// A stage row reads faster as a proportion than as a bare number
const StageBar = ({ stage, total }) => {
  const pct = total ? Math.round((stage.count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
      <span className="text-sm text-[#2a2426] w-40 shrink-0 truncate" title={stage.label}>
        {stage.label}
        {stage.retired && <span className="text-[#948d88]"> · retired</span>}
      </span>
      <div className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden min-w-[60px]">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: stage.color }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums text-[#2a2426] w-12 text-right">
        {num(stage.count)}
      </span>
      <span className="text-xs text-[#948d88] tabular-nums w-10 text-right">{pct}%</span>
    </div>
  );
};

// ---------------------------------------------------------------------------

const ReportsPage = () => {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  // Openings are listed newest-activity-first and there are usually more than
  // fit on a screen; the rest stay one click away
  const [allOpenings, setAllOpenings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getReport(days);
      setReport(res.data);
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  // Entity colours/labels for the badges
  useEffect(() => {
    getEntities()
      .then((res) => registerEntities(res.data.entities || []))
      .catch(() => {});
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await exportReportCsv(days);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `careers-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      notify.success("Report downloaded.");
    } catch {
      notify.error("Could not download the report.");
    } finally {
      setExporting(false);
    }
  };

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="w-8 h-8 rounded-full border-2 border-[#d8d3cf] border-t-[#a81724] animate-spin" />
      </div>
    );
  }
  if (!report) return null;

  const { users, entities, openings, applications, activity, scope } = report;
  const openingRows = allOpenings ? openings.list : openings.list.slice(0, 10);
  const scopeLabel = scope.branch
    ? `${groupMeta(scope.entity).label} · ${scope.branch}`
    : scope.entity
      ? groupMeta(scope.entity).label
      : "All entities";

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="Reports"
        title="Portal report"
        sub={
          <span className="text-[#7d7679]">
            {scopeLabel} · generated {timeAgo(report.generated_at)} · times in {report.timezone}
          </span>
        }
        actions={
          <>
            <div className="flex items-center rounded-full bg-stone-100 p-1">
              {RANGES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    days === d ? "bg-[#231b1d] text-white" : "text-[#2a2426] hover:bg-stone-200/70"
                  }`}
                >
                  {d} days
                </button>
              ))}
            </div>
            <button onClick={load} className={btnGhost} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button onClick={handleExport} className={btnDark} disabled={exporting}>
              {exporting ? "Preparing…" : "Download CSV"}
            </button>
          </>
        }
      />

      {/* ---- Headline counters ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Applications"
          value={num(applications.total)}
          sub={`${num(applications.in_period)} in the last ${report.period_days} days`}
          to="/admin/applications"
        />
        <Stat
          label="Active openings"
          value={num(openings.active)}
          sub={
            openings.active_without_applications > 0
              ? `${openings.active_without_applications} with no applications yet`
              : "every vacancy has applicants"
          }
          tone={openings.active_without_applications > 0 ? "accent" : "ink"}
          to="/admin/openings"
        />
        <Stat
          label="Entities"
          value={num(entities.active)}
          sub={`${num(entities.branches.length)} branches`}
        />
        <Stat
          label="Active users"
          value={num(users.active)}
          sub={users.restricted ? "roster hidden for this role" : `of ${num(users.total)} accounts`}
        />
      </div>

      {/* ---- Users ---- */}
      <Section
        title="Users"
        sub="Who can sign in, and when they last did"
        right={
          !users.restricted && (
            <div className="flex flex-wrap gap-2 text-xs">
              {users.never_logged_in > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-medium">
                  {users.never_logged_in} never signed in
                </span>
              )}
              {users.pending_first_login > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-medium">
                  {users.pending_first_login} on the initial password
                </span>
              )}
              <span className="px-2.5 py-1 rounded-full bg-stone-100 text-[#2a2426] font-medium">
                {users.with_2fa} of {users.active} with 2FA
              </span>
            </div>
          )
        }
      >
        {users.restricted ? (
          <div className={`${card} p-6 text-sm text-[#7d7679]`}>
            {num(users.active)} active accounts of {num(users.total)}. Managing users is not part of
            this role, so the roster is not shown.
          </div>
        ) : (
          <Table
            head={[
              "User",
              "Role",
              "Scope",
              "Status",
              "2FA",
              { key: "last", label: "Last login", align: "right" },
            ]}
          >
            {users.list.map((u) => (
              <tr key={u.id} className="hover:bg-stone-50/60">
                <Td>
                  <span className="font-medium">{u.name}</span>
                  <span className="block text-xs text-[#948d88]">{u.email}</span>
                </Td>
                <Td muted>{u.role}</Td>
                <Td>
                  {u.entity ? (
                    <span className="flex items-center gap-1.5">
                      <GroupBadge group={u.entity} />
                      {u.branch && <span className="text-xs text-[#7d7679]">{u.branch}</span>}
                    </span>
                  ) : (
                    <span className="text-xs text-[#7d7679]">All entities</span>
                  )}
                </Td>
                <Td>
                  <StatusBadge active={u.is_active} />
                </Td>
                <Td muted>{u.totp_enabled ? "On" : "—"}</Td>
                <Td right muted={!u.last_login_at}>
                  {timeAgo(u.last_login_at)}
                  {u.must_change_password && (
                    <span className="block text-[11px] text-amber-700">initial password</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* ---- Entities and branches ---- */}
      <Section title="Entities & branches" sub="How the group is configured, and what each part has attracted">
        <div className="grid gap-3 md:grid-cols-2">
          {entities.list.map((e) => {
            const own = entities.branches.filter((b) => b.entity === e.code);
            return (
              <div key={e.code} className={`${card} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: e.color }}
                      />
                      <h4 className="font-poppins font-semibold text-[#2a2426]">{e.name}</h4>
                      {!e.is_active && (
                        <span className="text-[10px] uppercase tracking-wider text-[#948d88]">
                          inactive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#948d88] mt-0.5">
                      {e.active_branches} of {e.branches} branches active ·{" "}
                      {e.active_openings} open vacancies
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-poppins text-xl font-semibold text-[#2a2426]">
                      {num(e.applications)}
                    </p>
                    <p className="text-[11px] text-[#948d88]">applications</p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-[#f0edea] space-y-1.5">
                  {own.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 text-xs">
                      <span className={`flex-1 truncate ${b.is_active ? "text-[#2a2426]" : "text-[#948d88] line-through"}`}>
                        {b.name}
                      </span>
                      <span className="text-[#7d7679] tabular-nums shrink-0">
                        {b.active_openings} open
                      </span>
                      <span className="w-12 text-right font-medium tabular-nums text-[#2a2426] shrink-0">
                        {num(b.applications)}
                      </span>
                    </div>
                  ))}
                  {!own.length && <p className="text-xs text-[#948d88]">No branches yet.</p>}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- Openings ---- */}
      <Section
        title="Job openings"
        sub={`${openings.active} active, ${openings.inactive} closed · ${num(
          openings.applications_to_active
        )} applications to active vacancies`}
        right={
          openings.list.length > 10 && (
            <button onClick={() => setAllOpenings((v) => !v)} className={btnGhost}>
              {allOpenings ? "Show top 10" : `Show all ${openings.list.length}`}
            </button>
          )
        }
      >
        <Table
          head={[
            "Position",
            "Branch",
            "Status",
            { key: "apps", label: "Applications", align: "right" },
            { key: "period", label: `Last ${report.period_days}d`, align: "right" },
            { key: "latest", label: "Most recent", align: "right" },
          ]}
        >
          {openingRows.map((o) => (
            <tr key={o.id} className="hover:bg-stone-50/60">
              <Td>
                <span className="font-medium">{o.position}</span>
                <span className="ml-2">
                  <GroupBadge group={o.entity} />
                </span>
              </Td>
              <Td muted>{o.branch}</Td>
              <Td>
                <StatusBadge active={o.is_active} onLabel="Open" offLabel="Closed" />
              </Td>
              <Td right>
                {o.applications === 0 && o.is_active ? (
                  <span className="text-[#a81724] font-semibold">0</span>
                ) : (
                  <span className="font-semibold">{num(o.applications)}</span>
                )}
              </Td>
              <Td right muted>
                {num(o.applications_in_period)}
              </Td>
              <Td right muted>
                {timeAgo(o.last_application_at)}
              </Td>
            </tr>
          ))}
        </Table>
      </Section>

      {/* ---- Applications ---- */}
      <Section
        title="Applications"
        sub={`${num(applications.total)} in total · most recent ${timeAgo(
          applications.last_received_at
        )}`}
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={`${card} p-5 lg:col-span-2`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88] mb-4">
              Hiring pipeline
            </p>
            <div className="space-y-3">
              {applications.stages.map((s) => (
                <StageBar key={s.key} stage={s} total={applications.total} />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88]">
                Where they came from
              </p>
              <div className="mt-3 space-y-2">
                {Object.entries(applications.by_site)
                  .sort((a, b) => b[1] - a[1])
                  .map(([site, count]) => (
                    <div key={site} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-[#2a2426]" title={site}>
                        {site}
                      </span>
                      <span className="font-semibold tabular-nums">{num(count)}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className={`${card} p-4 space-y-2`}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#2a2426]">Today</span>
                <span className="font-semibold tabular-nums">{num(applications.today)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#2a2426]">Last 7 days</span>
                <span className="font-semibold tabular-nums">{num(applications.week)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#2a2426]">Employee referrals</span>
                <span className="font-semibold tabular-nums">{num(applications.referred)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#2a2426]">Handed to another branch</span>
                <span className="font-semibold tabular-nums">{num(applications.handed_over)}</span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ---- Activity ---- */}
      <Section
        title="Pipeline activity"
        sub={`What the team has done in the last ${report.period_days} days`}
        right={
          <span className="text-xs text-[#7d7679]">
            {num(activity.total - activity.submissions)} actions ·{" "}
            {num(activity.submissions)} new applications
          </span>
        }
      >
        <Table
          head={[
            "User",
            "Last action",
            { key: "count", label: "Actions", align: "right" },
            { key: "when", label: "When", align: "right" },
          ]}
        >
          {activity.by_user.map((a) => (
            <tr key={a.id} className="hover:bg-stone-50/60">
              <Td>
                <span className="font-medium">{a.name}</span>
                <span className="block text-xs text-[#948d88]">{a.email}</span>
              </Td>
              <Td muted>
                <span className="capitalize">{a.last_action || "—"}</span>
                {a.last_detail && (
                  <span className="block text-xs text-[#948d88] truncate max-w-md" title={a.last_detail}>
                    {a.last_detail}
                  </span>
                )}
              </Td>
              <Td right>
                <span className="font-semibold">{num(a.actions)}</span>
              </Td>
              <Td right muted>
                {timeAgo(a.last_action_at)}
              </Td>
            </tr>
          ))}
        </Table>
        {!activity.by_user.length && (
          <div className={`${card} p-6 text-sm text-[#7d7679] mt-3`}>
            Nobody has touched the pipeline in this period.
          </div>
        )}
      </Section>
    </div>
  );
};

export default ReportsPage;
