import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import {
  getApplicationStats,
  getApplications,
  getAdminOpenings,
  getEntities,
  getPublicBranches,
  getActiveFlowOptions,
} from "../../services/api";
import {
  card,
  btnDark,
  btnGhost,
  Avatar,
  GroupBadge,
  StatusBadge,
  PageHeader,
  registerEntities,
  groupMeta,
  parseDbDate,
  formatDate,
  buildDailySeries,
  GroupDonut,
} from "../ui";

// ---------------------------------------------------------------------------
// Helpers

const timeAgo = (s) => {
  const d = parseDbDate(s);
  if (!d) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(s);
};

// ---------------------------------------------------------------------------
// Trend chart — bars read far better than a line when most days are zero.
// Long ranges are bucketed by week so the bars stay wide enough to see.

const RANGES = [
  { days: 7, label: "7 days", bucket: 1 },
  { days: 30, label: "30 days", bucket: 1 },
  { days: 90, label: "90 days", bucket: 7 },
];

const bucketSeries = (series, bucketDays) => {
  if (bucketDays <= 1) {
    return series.map((p) => ({ ...p, label: formatDate(p.key), spanDays: 1 }));
  }
  const out = [];
  for (let i = 0; i < series.length; i += bucketDays) {
    const slice = series.slice(i, i + bucketDays);
    const first = slice[0];
    const last = slice[slice.length - 1];
    out.push({
      key: first.key,
      date: first.date,
      count: slice.reduce((sum, p) => sum + p.count, 0),
      label: `${formatDate(first.key)} – ${formatDate(last.key)}`,
      spanDays: slice.length,
    });
  }
  return out;
};

const CW = 720;
const CH = 220;
const CPAD = { top: 16, right: 8, bottom: 28, left: 32 };

const TrendChart = ({ series, bucketDays }) => {
  const [hover, setHover] = useState(null);

  const { bars, yTicks, top } = useMemo(() => {
    const points = bucketSeries(series, bucketDays);
    const innerW = CW - CPAD.left - CPAD.right;
    const innerH = CH - CPAD.top - CPAD.bottom;
    const maxY = Math.max(1, ...points.map((p) => p.count));
    const step = Math.max(1, Math.ceil(maxY / 4));
    const topValue = step * 4;
    const slot = innerW / points.length;
    const width = Math.max(3, Math.min(slot - 3, 34));

    const list = points.map((p, i) => {
      const h = (p.count / topValue) * innerH;
      return {
        ...p,
        x: CPAD.left + i * slot + (slot - width) / 2,
        y: CPAD.top + innerH - h,
        w: width,
        h,
        slotX: CPAD.left + i * slot,
        slotW: slot,
      };
    });
    const ticks = [0, 1, 2, 3, 4].map((i) => ({
      value: i * step,
      y: CPAD.top + innerH * (1 - i / 4),
    }));
    return { bars: list, yTicks: ticks, top: topValue };
  }, [series, bucketDays]);

  // A readable number of x labels regardless of how many bars there are
  const labelEvery = Math.ceil(bars.length / 6);
  const hovered = hover != null ? bars[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-auto block" role="img">
        {yTicks.map((t) => (
          <g key={t.value}>
            <line
              x1={CPAD.left}
              x2={CW - CPAD.right}
              y1={t.y}
              y2={t.y}
              stroke="#eceae7"
              strokeWidth="1"
              strokeDasharray={t.value === 0 ? "none" : "3 5"}
            />
            <text x={CPAD.left - 8} y={t.y + 3.5} textAnchor="end" fontSize="10" fill="#a8a29e">
              {t.value}
            </text>
          </g>
        ))}

        {bars.map((b, i) => (
          <g key={b.key}>
            {/* Full-height hit area so thin bars stay easy to hover */}
            <rect
              x={b.slotX}
              y={CPAD.top}
              width={b.slotW}
              height={CH - CPAD.top - CPAD.bottom}
              fill={hover === i ? "#a8172408" : "transparent"}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            {b.count > 0 && (
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={Math.min(3, b.w / 2)}
                fill={hover === i ? "#8a1420" : "#a81724"}
                className="pointer-events-none transition-[fill]"
              />
            )}
            {i % labelEvery === 0 && (
              <text
                x={b.slotX + b.slotW / 2}
                y={CH - 8}
                textAnchor="middle"
                fontSize="10"
                fill="#a8a29e"
              >
                {b.date.toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  timeZone: "UTC",
                })}
              </text>
            )}
          </g>
        ))}
      </svg>

      {hovered && (
        <div
          className="absolute -top-1 pointer-events-none bg-[#231b1d] text-white rounded-lg px-3 py-1.5 text-xs whitespace-nowrap -translate-x-1/2 z-10"
          style={{
            left: `${Math.min(88, Math.max(12, ((hovered.slotX + hovered.slotW / 2) / CW) * 100))}%`,
          }}
        >
          <span className="font-semibold">{hovered.count}</span>{" "}
          {hovered.count === 1 ? "application" : "applications"}
          <span className="text-white/60"> · {hovered.label}</span>
        </div>
      )}
      {top === 4 && bars.every((b) => b.count === 0) && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-[#948d88]">
          No applications in this period
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// KPI cards for the dark band

const MiniSpark = ({ data, strong }) => {
  if (!data || data.length < 2) return null;
  const SW = 96;
  const SH = 26;
  const P = 2;
  const max = Math.max(1, ...data);
  const pts = data
    .map(
      (v, i) =>
        `${P + (i * (SW - 2 * P)) / (data.length - 1)},${P + (SH - 2 * P) * (1 - v / max)}`
    )
    .join(" ");
  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} className="w-24 h-6" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={strong ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.35)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const StatCard = ({ label, value, sub, accent, to, spark }) => {
  const inner = (
    <div
      className={`rounded-2xl p-5 flex flex-col justify-between min-h-[128px] transition-colors ${
        accent
          ? "bg-[#a81724] text-white hover:bg-[#96131f]"
          : "bg-white/[0.06] border border-white/10 text-white hover:bg-white/[0.1]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-semibold ${accent ? "text-white" : "text-white/85"}`}>{label}</p>
        {to && (
          <span
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
              accent ? "bg-white/20" : "bg-white/10"
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7 M8 7h9v9" />
            </svg>
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="font-poppins text-3xl font-semibold leading-none">{value}</p>
          {sub && (
            <p className={`text-xs mt-2 ${accent ? "text-white/75" : "text-white/55"}`}>{sub}</p>
          )}
        </div>
        <MiniSpark data={spark} strong={accent} />
      </div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
};

// ---------------------------------------------------------------------------

const DashboardPage = () => {
  const { user, can } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [openings, setOpenings] = useState(null);
  const [entityList, setEntityList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [stageOptions, setStageOptions] = useState([]);
  const [hoverGroup, setHoverGroup] = useState(null);
  const [range, setRange] = useState(RANGES[1]); // 30 days reads best by default

  const canApplications = can("applications.view");
  const canOpenings = can("openings.view");

  useEffect(() => {
    if (!canApplications) return;
    getApplicationStats().then((res) => setStats(res.data)).catch(() => {});
    // More than fits on screen: the list scrolls inside its fixed-height card
    getApplications({ page: 1, limit: 15 })
      .then((res) => setRecent(res.data.applications))
      .catch(() => {});
    getEntities()
      .then((res) => {
        registerEntities(res.data.entities);
        setEntityList(res.data.entities);
      })
      .catch(() => {});
    getPublicBranches()
      .then((res) => setBranches(res.data.branches))
      .catch(() => {});
    getActiveFlowOptions()
      .then((res) => setStageOptions(res.data.stages || []))
      .catch(() => {});
  }, [canApplications]);

  useEffect(() => {
    if (!canOpenings) return;
    getAdminOpenings().then((res) => setOpenings(res.data.openings)).catch(() => {});
  }, [canOpenings]);

  // Users whose role has no applications access land on their first permitted page
  if (!canApplications) {
    const fallback = [
      ["openings.view", "/admin/openings"],
      ["entities.manage", "/admin/entities"],
      ["branches.manage", "/admin/branches"],
      ["users.manage", "/admin/users"],
      ["roles.manage", "/admin/roles"],
    ].find(([p]) => can(p));
    if (fallback) return <Navigate to={fallback[1]} replace />;
    return <p className="text-sm text-[#948d88] p-6">Your role has no admin modules assigned.</p>;
  }

  // stats.byDay only exists on the updated backend; render honest empty states otherwise
  const fullSeries = stats?.byDay ? buildDailySeries(stats.byDay) : null;
  const series = fullSeries ? fullSeries.slice(-range.days) : null;
  const spark14 = fullSeries ? fullSeries.slice(-14).map((p) => p.count) : null;
  const periodTotal = series ? series.reduce((sum, p) => sum + p.count, 0) : null;

  const week = stats?.week;
  const prevWeek = stats?.prevWeek ?? 0;
  const delta =
    week == null || prevWeek === 0 ? null : Math.round(((week - prevWeek) / prevWeek) * 100);
  const weekSub =
    week == null ? (
      "vs previous week"
    ) : delta == null ? (
      prevWeek === 0 && week > 0 ? "no submissions previous week" : "vs previous week"
    ) : (
      <span className={delta >= 0 ? "text-emerald-400" : "text-red-300"}>
        {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%{" "}
        <span className="text-white/55">vs previous week</span>
      </span>
    );

  const activeOpenings = openings ? openings.filter((o) => o.is_active) : null;
  const latestOpenings = openings ? openings.slice(0, 5) : [];
  const openingsFor = (code) =>
    activeOpenings ? activeOpenings.filter((o) => o.school_group === code).length : null;
  const branchesFor = (code) => branches.filter((b) => b.school_group === code).length;

  // Hiring pipeline: configured stages with their share of applications.
  // Deactivating a stage hides it from the dropdowns but does not move the
  // candidates already parked on it, so any leftover bucket is shown too -
  // otherwise those candidates vanish from the chart and every percentage is
  // computed against the wrong total.
  const pipeline = [
    ...stageOptions.map((s) => ({
      key: s.key,
      label: s.label,
      hex: s.color || "#78716c",
      count: stats?.byStage?.[s.key] ?? 0,
    })),
    ...Object.entries(stats?.byStage || {})
      .filter(([key, count]) => count > 0 && !stageOptions.some((s) => s.key === key))
      .map(([key, count]) => ({
        key,
        // Retired stages have no configured label left to show
        label: `${key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} (retired)`,
        hex: "#a8a29e",
        count,
      })),
  ];
  const pipelineTotal = pipeline.reduce((sum, s) => sum + s.count, 0);
  const awaiting = stats?.byStage?.new ?? 0;

  const groups = entityList
    .filter((e) => e.is_active)
    .map((e) => ({
      key: e.code,
      label: e.name,
      short: e.code,
      hex: e.color || "#a81724",
      count: stats?.byGroup?.[e.code] ?? 0,
    }))
    .filter((g) => !user?.school_group || user.school_group === g.key);
  const groupsTotal = groups.reduce((sum, g) => sum + g.count, 0);

  const firstName = String(user?.name || "").trim().split(/\s+/)[0] || "there";
  const todayLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <PageHeader
        eyebrow="Admin · Overview"
        title={`Welcome back, ${firstName}`}
        sub={<span className="text-[#948d88]">{todayLabel}</span>}
        actions={
          <>
            <Link to="/admin/applications" className={btnGhost}>
              View applications
            </Link>
            {canOpenings && (
              <Link to="/admin/openings" className={btnDark}>
                Manage openings
              </Link>
            )}
          </>
        }
      />

      {/* Dark KPI band */}
      <section className="relative overflow-hidden bg-[#231b1d] rounded-3xl p-4 sm:p-5 mb-4">
        {/* Ambient glow accents */}
        <div className="pointer-events-none absolute -top-28 -right-20 w-80 h-80 rounded-full bg-[#a81724]/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 left-1/4 w-96 h-96 rounded-full bg-white/[0.05] blur-3xl" />

        <div className="relative">
          <div className="flex items-center justify-between px-1 pb-4">
            <h3 className="font-poppins text-lg font-semibold text-white">Applications</h3>
            <span className="text-xs font-semibold text-white/60 bg-white/10 rounded-full px-3 py-1.5">
              {user?.branch_name ||
                (user?.school_group ? groupMeta(user.school_group).label : "All schools")}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard
              label="Total Applications"
              value={stats ? stats.total : "…"}
              sub="all time"
              accent
              to="/admin/applications"
              spark={spark14}
            />
            <StatCard
              label="Awaiting Screening"
              value={stats ? awaiting : "…"}
              sub="not screened yet"
              to="/admin/applications?status=new"
            />
            <StatCard
              label="In Interview"
              value={stats ? stats.byStage?.in_interview ?? 0 : "…"}
              sub="interview in progress"
              to="/admin/applications?status=in_interview"
            />
            <StatCard
              label="Last 7 Days"
              value={stats ? week ?? "—" : "…"}
              sub={weekSub}
              spark={spark14}
            />
          </div>
        </div>
      </section>

      {/* Trend + recent applications */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-poppins text-base font-semibold text-[#2a2426]">
                Applications Trend
              </h3>
              <p className="text-xs text-[#948d88] mt-0.5">
                {range.bucket > 1 ? "Weekly submissions" : "Daily submissions"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {periodTotal != null && (
                <span className="text-xs font-semibold text-[#a81724] bg-[#a81724]/5 rounded-full px-3 py-1.5">
                  {periodTotal} in period
                </span>
              )}
              {/* Range selector: short windows stay daily, 90 days rolls up weekly */}
              <div className="flex items-center gap-0.5 bg-stone-100 rounded-full p-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r.days}
                    onClick={() => setRange(r)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      range.days === r.days
                        ? "bg-[#231b1d] text-white"
                        : "text-stone-600 hover:text-[#2a2426]"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {series ? (
            <TrendChart series={series} bucketDays={range.bucket} />
          ) : (
            <div className="h-[230px] flex flex-col items-center justify-center gap-1 text-center">
              <p className="text-sm font-medium text-stone-500">Trend data not available yet</p>
              <p className="text-xs text-[#948d88]">
                {stats ? "Restart the backend to enable the daily trend feed." : "Loading…"}
              </p>
            </div>
          )}
        </div>

        {/* Wrapper stays in flow so the row height comes from the chart card;
            the card itself is pinned to that height and its list scrolls */}
        <div className="relative">
        <div className={`${card} p-5 flex flex-col lg:absolute lg:inset-0`}>
          <div className="flex items-center justify-between mb-2 shrink-0">
            <h3 className="font-poppins text-base font-semibold text-[#2a2426]">Recent Applications</h3>
            <Link
              to="/admin/applications"
              title="View all applications"
              className="w-7 h-7 rounded-full border border-[#e7e4e1] flex items-center justify-center text-stone-500 hover:text-[#2a2426] hover:border-[#a8a29e] transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7 M8 7h9v9" />
              </svg>
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-[#948d88] py-4">No applications yet.</p>
          ) : (
            <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f3f1ee] -mr-2 pr-2">
              {recent.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1 -mx-2 px-2 rounded-xl hover:bg-stone-50 transition-colors"
                >
                  <Avatar name={a.full_name} group={a.school_group} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#2a2426] truncate">{a.full_name}</p>
                    <p className="text-xs text-[#948d88] truncate">
                      {a.position}
                      {a.branch ? ` · ${a.branch}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <GroupBadge group={a.school_group} />
                    <p className="text-[10px] text-[#948d88] mt-1">{timeAgo(a.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/admin/applications"
            className="text-xs font-semibold text-[#a81724] hover:underline mt-3 self-start shrink-0"
          >
            View all applications →
          </Link>
        </div>
        </div>
      </div>

      {/* Hiring pipeline by profile stage */}
      {pipeline.length > 0 && (
        <div className={`${card} p-5 mb-4`}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-poppins text-base font-semibold text-[#2a2426]">
                Hiring Pipeline
              </h3>
              <p className="text-xs text-[#948d88] mt-0.5">
                Where every applicant stands · click a stage to filter
              </p>
            </div>
            {stats?.referred > 0 && (
              <Link
                to="/admin/applications?referred=1"
                className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 hover:bg-amber-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 14l5-5-5-5 M20 9H9.5A5.5 5.5 0 0 0 4 14.5V18" />
                </svg>
                {stats.referred} referred
              </Link>
            )}
          </div>

          {/* Stacked share bar */}
          <div className="h-3 rounded-full bg-stone-100 overflow-hidden flex mb-4">
            {pipeline
              .filter((s) => s.count > 0)
              .map((s) => (
                <div
                  key={s.key}
                  className="h-full transition-[width] duration-500"
                  style={{
                    width: `${pipelineTotal ? (s.count / pipelineTotal) * 100 : 0}%`,
                    backgroundColor: s.hex,
                  }}
                  title={`${s.label}: ${s.count}`}
                />
              ))}
          </div>

          {/* One row on desktop however many stages are configured; wraps below lg */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-none lg:grid-flow-col lg:auto-cols-fr gap-2.5">
            {pipeline.map((s) => {
              const share = pipelineTotal ? Math.round((s.count / pipelineTotal) * 100) : 0;
              return (
                <Link
                  key={s.key}
                  to={`/admin/applications?status=${encodeURIComponent(s.key)}`}
                  title={`${s.label}: ${s.count} (${share}%)`}
                  className="min-w-0 rounded-xl border border-[#efece9] px-3 py-2.5 hover:border-[#d8d3cf] hover:bg-stone-50 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: s.hex }}
                    />
                    <span className="text-[11px] font-semibold text-stone-600 truncate">
                      {s.label}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-1.5 mt-1">
                    <span className="font-poppins text-xl font-semibold text-[#2a2426] leading-none">
                      {s.count}
                    </span>
                    <span className="font-mono text-[10px] text-[#948d88]">{share}%</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Groups distribution + latest openings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-poppins text-base font-semibold text-[#2a2426] mb-4">
            Applications by Group
          </h3>
          {groups.length === 0 ? (
            <p className="text-sm text-[#948d88]">No groups configured.</p>
          ) : (
            <div className="flex items-center gap-5">
              <GroupDonut
                segments={groups}
                total={groupsTotal}
                hovered={hoverGroup}
                onHover={setHoverGroup}
                className="w-28 h-28"
              />
              <ul className="flex-1 min-w-0 space-y-1">
                {groups.map((g) => {
                  const share = groupsTotal ? Math.round((g.count / groupsTotal) * 100) : 0;
                  return (
                    <li
                      key={g.key}
                      onMouseEnter={() => setHoverGroup(g.key)}
                      onMouseLeave={() => setHoverGroup(null)}
                      className={`flex items-center gap-2.5 text-sm rounded-xl px-2.5 py-2 -mx-1 cursor-default transition-colors ${
                        hoverGroup === g.key ? "bg-stone-50" : ""
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: g.hex }}
                      />
                      <span className="flex-1 text-stone-600 font-medium truncate">{g.label}</span>
                      <span className="font-mono text-xs text-[#2a2426]">{g.count}</span>
                      <span className="font-mono text-[11px] font-semibold text-[#2a2426] bg-stone-100 rounded-full px-2 py-0.5 min-w-[42px] text-center">
                        {share}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Compact capacity per group: openings, branches, applications per role */}
          {groups.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#f0edea] space-y-2.5">
              {groups.map((g) => {
                const roles = canOpenings ? openingsFor(g.key) : null;
                const branchCount = branchesFor(g.key);
                const share = groupsTotal ? Math.round((g.count / groupsTotal) * 100) : 0;
                return (
                  <div
                    key={g.key}
                    onMouseEnter={() => setHoverGroup(g.key)}
                    onMouseLeave={() => setHoverGroup(null)}
                    className={`rounded-xl px-2.5 py-2 -mx-1 transition-colors ${
                      hoverGroup === g.key ? "bg-stone-50" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5 shrink-0"
                        style={{ color: g.hex, backgroundColor: `${g.hex}14` }}
                      >
                        {g.short}
                      </span>
                      <span className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
                        <span
                          className="block h-full rounded-full transition-[width] duration-500"
                          style={{ width: `${share}%`, backgroundColor: g.hex }}
                        />
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[#948d88]">
                      {roles != null && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          {roles} role{roles === 1 ? "" : "s"}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 21h18 M5 21V7l7-4v18 M19 21V11l-7-4" />
                        </svg>
                        {branchCount} branch{branchCount === 1 ? "" : "es"}
                      </span>
                      {roles ? (
                        <span className="ml-auto font-mono font-semibold text-[#2a2426]">
                          {(g.count / roles).toFixed(1)}/role
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {canOpenings && (
          <div className={`${card} p-5 lg:col-span-2`}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <h3 className="font-poppins text-base font-semibold text-[#2a2426]">
                  Latest Openings
                </h3>
                {activeOpenings && (
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
                    {activeOpenings.length} active
                  </span>
                )}
              </div>
              <Link to="/admin/openings" className="text-xs font-semibold text-[#a81724] hover:underline">
                Manage all
              </Link>
            </div>
            {latestOpenings.length === 0 ? (
              <p className="text-sm text-[#948d88]">
                {openings ? "No openings posted yet." : "Loading…"}
              </p>
            ) : (
              <ul className="divide-y divide-[#f3f1ee]">
                {latestOpenings.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 -mx-2 px-2 rounded-xl hover:bg-stone-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#2a2426] truncate">{o.position}</p>
                      <p className="text-xs text-[#948d88] truncate">
                        {o.branch || "All branches"} · posted {formatDate(o.created_at)}
                      </p>
                    </div>
                    <GroupBadge group={o.school_group} />
                    <StatusBadge active={!!o.is_active} onLabel="Open" offLabel="Closed" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default DashboardPage;
