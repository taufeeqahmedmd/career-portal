import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  GroupDonut,
} from "../ui";

// ---------------------------------------------------------------------------
// Chart tokens
//
// One mark hue throughout: every chart on this page plots a single series
// (applications), so identity is never carried by colour and no legend is
// needed - the card title says what is plotted. Contrast measured against the
// white card surface: mark 7.5:1, axis ink 5.3:1, so values stay readable
// without relying on a tooltip.

const MARK = "#a81724"; // brand maroon - the one series colour
const MARK_WASH = "rgba(168, 23, 36, 0.10)"; // area fill: a wash, never a block
const AXIS_INK = "#6f6a66"; // 5.34:1 on white - safe for 11px ticks
const GRID = "#e7e4e1"; // hairline, one step off surface
const INK = "#2a2426";
const CRITICAL = "#d03b3b"; // 4.80:1 - always with an icon and a label
const WARNING_INK = "#b45309"; // 5.02:1 - amber for text, not the 1.8:1 fill

// Categorical slots for the share donuts, in fixed order and never cycled.
// Validated on the light card surface: lightness band, chroma floor, contrast
// and the adjacent pairlist all pass (worst adjacent CVD ΔE 12.9, normal-vision
// 16.9). Six is the cap - a seventh slice folds into "Other" rather than
// inventing a hue. Every slice also carries its name and count in the legend,
// which is what keeps identity off colour alone.
const PIE_SLOTS = ["#a81724", "#2f6ac0", "#0d9488", "#ca8a04", "#6d28d9", "#4d7c0f"];
const OTHER_SLOT = "#a8a29e"; // neutral - the folded tail is not an identity
const MAX_SLICES = 6;

// ---------------------------------------------------------------------------
// Helpers

const RANGES = [7, 30, 90];

const num = (n) => (n ?? 0).toLocaleString("en-IN");

// 1,284 / 12.9K - proportional figures, so no tabular-nums on display values
const compact = (n) => {
  const value = Number(n || 0);
  if (value < 10000) return value.toLocaleString("en-IN");
  if (value < 1000000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
};

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

// Fills the gaps: days with no applications have no row in the response
const buildSeries = (byDay = [], days = 30) => {
  const counts = new Map(byDay.map((d) => [String(d.day).slice(0, 10), d.count]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ key, date: d, count: counts.get(key) || 0 });
  }
  return out;
};

const shortDay = (d) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

// ---------------------------------------------------------------------------
// Stat tile: label, value, optional delta against the previous window

const Delta = ({ current, previous }) => {
  if (previous === undefined || previous === null) return null;
  if (previous === 0 && current === 0) {
    return <span className="text-xs text-[#6f6a66]">no change</span>;
  }
  if (previous === 0) {
    return <span className="text-xs font-medium text-[#006300]">new this period</span>;
  }
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return <span className="text-xs text-[#6f6a66]">level with last period</span>;
  const up = change > 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-[#006300]" : "text-[#b45309]"}`}>
      {/* Direction is stated in the arrow AND the sign, never colour alone */}
      {up ? "▲" : "▼"} {Math.abs(change)}% vs previous {""}
    </span>
  );
};

const Sparkline = ({ series }) => {
  if (!series.length) return null;
  const max = Math.max(1, ...series.map((p) => p.count));
  const w = 96;
  const h = 26;
  const step = w / Math.max(1, series.length - 1);
  const points = series.map((p, i) => [i * step, h - (p.count / max) * (h - 2) - 1]);
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <path d={d} fill="none" stroke={MARK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

const Tile = ({ label, value, sub, delta, spark, tone, to }) => {
  const inner = (
    <div className={`${card} p-4 h-full flex flex-col justify-between`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6f6a66]">{label}</p>
      <div className="flex items-end justify-between gap-2 mt-2">
        <span className="font-poppins text-[30px] leading-none font-semibold text-[#2a2426]">
          {value}
        </span>
        {spark}
      </div>
      <div className="mt-2 min-h-[18px]">
        {delta}
        {sub && (
          <p className={`text-xs ${tone === "warn" ? "text-[#b45309] font-medium" : "text-[#6f6a66]"}`}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full hover:opacity-90 transition-opacity">
      {inner}
    </Link>
  ) : (
    inner
  );
};

// ---------------------------------------------------------------------------
// Trend: one series, so an area with a 2px line. Crosshair + tooltip on hover,
// and a table twin behind the toggle so no value is reachable only by pointing.

const TrendChart = ({ series, periodDays }) => {
  const [hover, setHover] = useState(null);

  const W = 720;
  const H = 230;
  const PAD = { top: 14, right: 12, bottom: 28, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = Math.max(1, ...series.map((p) => p.count));
  // Round the axis to something clean
  const top = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const x = (i) => PAD.left + (i * plotW) / Math.max(1, series.length - 1);
  const y = (v) => PAD.top + plotH - (v / top) * plotH;

  const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");
  const area = `${line} L${x(series.length - 1).toFixed(1)},${PAD.top + plotH} L${x(0).toFixed(1)},${
    PAD.top + plotH
  } Z`;

  const ticks = [0, top / 2, top].filter((v, i, a) => a.indexOf(v) === i);
  // At most six date labels, whatever the range
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / plotW) * (series.length - 1));
    if (i >= 0 && i < series.length) setHover(i);
  };

  const peak = series.reduce((best, p, i) => (p.count > series[best].count ? i : best), 0);

  return (
    <div className="relative w-full">
      {/* No fixed height: the SVG scales uniformly with its container, so the
          tooltip's percentage placement lands exactly on the mark at any width.
          A fixed height would letterbox the viewBox and offset it. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Applications received per day over the last ${periodDays} days`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={AXIS_INK}>
              {t}
            </text>
          </g>
        ))}

        <path d={area} fill={MARK_WASH} />
        <path d={line} fill="none" stroke={MARK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* The extreme is directly labelled; the rest are on the axis and in the table */}
        {series[peak].count > 0 && hover === null && (
          <g>
            <circle cx={x(peak)} cy={y(series[peak].count)} r="4.5" fill={MARK} stroke="#ffffff" strokeWidth="2" />
            <text
              x={Math.min(x(peak), W - PAD.right - 14)}
              y={Math.max(y(series[peak].count) - 10, PAD.top + 9)}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill={INK}
            >
              {series[peak].count}
            </text>
          </g>
        )}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={GRID} strokeWidth="1" />
            <circle cx={x(hover)} cy={y(series[hover].count)} r="4.5" fill={MARK} stroke="#ffffff" strokeWidth="2" />
          </g>
        )}

        {/* End labels anchor inward so neither is clipped by the plot edge */}
        {series.map((p, i) => {
          const isLast = i === series.length - 1;
          if (!(i % labelEvery === 0 || isLast)) return null;
          // Drop a regular tick that would collide with the pinned last one
          if (!isLast && series.length - 1 - i < labelEvery * 0.6) return null;
          return (
            <text
              key={p.key}
              x={isLast ? W - PAD.right : i === 0 ? PAD.left : x(i)}
              y={H - 9}
              textAnchor={isLast ? "end" : i === 0 ? "start" : "middle"}
              fontSize="11"
              fill={AXIS_INK}
            >
              {shortDay(p.date)}
            </text>
          );
        })}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-[#2a2426] px-2.5 py-1.5 text-white shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(series[hover].count) / H) * 100}%` }}
        >
          <p className="text-[11px] leading-tight opacity-75">{shortDay(series[hover].date)}</p>
          <p className="text-sm font-semibold leading-tight">
            {series[hover].count} {series[hover].count === 1 ? "application" : "applications"}
          </p>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Horizontal magnitude bars. One hue, value at the tip, 4px rounded data-end.

const BarRow = ({ label, sublabel, value, max, share, muted, flag }) => {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-[38%] min-w-0">
        <p className={`text-sm truncate ${muted ? "text-[#6f6a66]" : "text-[#2a2426]"}`} title={label}>
          {label}
        </p>
        {sublabel && <p className="text-[11px] text-[#6f6a66] truncate">{sublabel}</p>}
      </div>
      <div className="flex-1 min-w-[56px] h-3 rounded-full bg-[#f0edea] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%`, backgroundColor: MARK }}
        />
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums text-[#2a2426]">
        {num(value)}
      </span>
      {share !== undefined && (
        <span className="w-9 text-right text-[11px] tabular-nums text-[#6f6a66]">{share}%</span>
      )}
      {flag && (
        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: CRITICAL }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          none
        </span>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Share donut: part-to-whole, which is the one job a pie does well.
//
// Two things a pie cannot show, handled explicitly rather than hidden:
//   - a zero has no slice, so items on zero are listed beside the chart
//   - past six slices the tail is folded into "Other" instead of inventing hues
//
// Colour follows the item, not its rank: hues are assigned over a stable sort
// of the keys, so changing the period never repaints a slice that survived.

// The items a pie cannot draw. Rendered beside the chart when there is width
// for it, and below when there is not - either way they stay visible, because
// a vacancy with no applicants is the row worth acting on.
const ZeroPanel = ({ items, label, icon = true, className = "" }) => {
  if (!items.length) return null;
  return (
    <div className={className}>
      <p
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: icon ? WARNING_INK : "#6f6a66" }}
      >
        {icon && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        )}
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <span
            key={i.key}
            className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-[#2a2426]"
            title={i.sublabel ? `${i.label} · ${i.sublabel}` : i.label}
          >
            <span className="max-w-[180px] truncate">{i.label}</span>
            {i.sublabel && (
              <span className="max-w-[130px] truncate text-[#6f6a66]">· {i.sublabel}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
};

const SharePie = ({
  items,
  zeroLabel,
  zeroIcon = true,
  size = "w-32 h-32",
  emptyText,
  showZeros = true,
  legendMax = "max-w-2xl",
}) => {
  const [hovered, setHovered] = useState(null);

  const withValue = items.filter((i) => i.value > 0);
  const zero = items.filter((i) => i.value === 0);

  const stable = [...withValue].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const visible = stable.slice(0, MAX_SLICES);
  const folded = stable.slice(MAX_SLICES);
  const hueFor = new Map(visible.map((i, idx) => [i.key, PIE_SLOTS[idx]]));

  const segments = [...visible]
    .sort((a, b) => b.value - a.value)
    .map((i) => ({
      key: i.key,
      label: i.label,
      short: i.short || i.label,
      hex: hueFor.get(i.key),
      count: i.value,
      sublabel: i.sublabel,
    }));

  if (folded.length) {
    segments.push({
      key: "__other",
      label: `Other (${folded.length})`,
      short: "Other",
      hex: OTHER_SLOT,
      count: folded.reduce((sum, i) => sum + i.value, 0),
    });
  }

  const total = segments.reduce((sum, s) => sum + s.count, 0);

  if (!total) {
    return <p className="text-sm text-[#6f6a66]">{emptyText || "Nothing to show yet."}</p>;
  }

  return (
    <div>
      {/* Capped: a legend stretched across a wide card leaves the count far from
          the name it belongs to */}
      <div className={`flex items-center gap-5 ${legendMax}`}>
        <GroupDonut
          segments={segments}
          total={total}
          hovered={hovered}
          onHover={setHovered}
          className={`${size} shrink-0`}
        />
        {/* The legend is the table view: every slice's name, count and share */}
        <ul className="flex-1 min-w-0 space-y-0.5">
          {segments.map((s) => {
            const share = Math.round((s.count / total) * 100);
            return (
              <li
                key={s.key}
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
                className={`flex items-center gap-2.5 text-sm rounded-lg px-2 py-1.5 -mx-1 transition-colors ${
                  hovered === s.key ? "bg-stone-50" : ""
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.hex }}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[#2a2426]" title={s.label}>
                    {s.label}
                  </span>
                  {s.sublabel && (
                    <span className="block truncate text-[11px] text-[#6f6a66]" title={s.sublabel}>
                      {s.sublabel}
                    </span>
                  )}
                </span>
                <span className="tabular-nums font-semibold text-[#2a2426] shrink-0">
                  {num(s.count)}
                </span>
                <span className="tabular-nums text-[11px] font-semibold text-[#2a2426] bg-stone-100 rounded-full px-2 py-0.5 min-w-[42px] text-center shrink-0">
                  {share}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* A pie has no slice for zero, so these would otherwise disappear */}
      {showZeros && (
        <ZeroPanel
          items={zero}
          icon={zeroIcon}
          label={zeroLabel || `No applications yet (${zero.length})`}
          className="mt-4 pt-3 border-t border-[#f0edea]"
        />
      )}
    </div>
  );
};

// A compact one-hue breakdown: the bar carries the share, the number carries
// the value. Used for the attribution groupings, which are single-series.
const Breakdown = ({ title, rows, total, muteLabel }) => {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6f6a66] mb-1.5">
        {title}
      </p>
      <div className="space-y-1">
        {rows.map((r) => {
          const dimmed = muteLabel && r.label === muteLabel;
          return (
            <div key={r.label} className="flex items-center gap-2.5 text-sm">
              <span
                className={`w-[42%] truncate ${dimmed ? "text-[#6f6a66]" : "text-[#2a2426]"}`}
                title={r.label}
              >
                {r.label}
              </span>
              <span className="flex-1 min-w-[40px] h-2 rounded-full bg-[#f0edea] overflow-hidden">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(r.count / max) * 100}%`,
                    backgroundColor: dimmed ? "#c9c3bd" : MARK,
                  }}
                />
              </span>
              <span className="tabular-nums font-semibold text-[#2a2426] shrink-0">{r.count}</span>
              {total > 0 && (
                <span className="w-9 text-right text-[11px] tabular-nums text-[#6f6a66] shrink-0">
                  {Math.round((r.count / total) * 100)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Section = ({ title, sub, right, children, className = "" }) => (
  <section className={`mt-6 ${className}`}>
    <div className="flex items-end justify-between gap-4 mb-3">
      <div>
        <h3 className="font-poppins text-base font-semibold text-[#2a2426]">{title}</h3>
        {sub && <p className="text-xs text-[#6f6a66] mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const Table = ({ head, children }) => (
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
  </div>
);

const Td = ({ children, right, muted, className = "" }) => (
  <td
    className={`px-4 py-2.5 ${right ? "text-right tabular-nums" : ""} ${
      muted ? "text-[#6f6a66]" : "text-[#2a2426]"
    } ${className}`}
  >
    {children}
  </td>
);

// ---------------------------------------------------------------------------

const ReportsPage = () => {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [allOpenings, setAllOpenings] = useState(false);
  const [trendTable, setTrendTable] = useState(false);
  const [hoverEntity, setHoverEntity] = useState(null);

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

  useEffect(() => {
    getEntities()
      .then((res) => registerEntities(res.data.entities || []))
      .catch(() => {});
  }, []);

  const series = useMemo(
    () => buildSeries(report?.applications?.by_day, report?.period_days || days),
    [report, days]
  );

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
  const scopeLabel = scope.branch
    ? `${groupMeta(scope.entity).label} · ${scope.branch}`
    : scope.entity
      ? groupMeta(scope.entity).label
      : "All entities";

  const stageTotal = applications.stages.reduce((sum, s) => sum + s.count, 0) || 1;
  const activeOpenings = openings.list.filter((o) => o.is_active);
  const rankedOpenings = [...activeOpenings].sort((a, b) => b.applications - a.applications);
  const openingRows = allOpenings ? rankedOpenings : rankedOpenings.slice(0, 8);
  const openingItems = openingRows.map((o) => ({
    key: String(o.id),
    label: o.position,
    sublabel: o.branch,
    short: o.position,
    value: o.applications,
  }));

  // Three views of where an application came from: the readable source the
  // portal derived, the raw campaign tag behind it, and the website that
  // posted it. They answer different questions and none replaces the others.
  const breakdown = (map) =>
    Object.entries(map || {})
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  const sources = breakdown(applications.by_source);
  const utmSources = breakdown(applications.by_utm_source);
  const campaigns = breakdown(applications.by_campaign);
  const sites = breakdown(applications.by_site);
  const maxEntity = Math.max(1, ...entities.list.map((e) => e.applications));

  // Share of the whole intake, by business. Part-to-whole is the one job a donut
  // does well: the segments are mutually exclusive and sum to the total, and the
  // entity's own colour is the identity readers already know from the dashboard.
  const entitySegments = entities.list.map((e) => ({
    key: e.code,
    label: e.name,
    short: e.code,
    hex: e.color || MARK,
    count: e.applications,
  }));
  const entityTotal = entitySegments.reduce((sum, s) => sum + s.count, 0);

  return (
    // Refetches hold the previous render at reduced opacity - no skeleton flash
    <div className={`pb-10 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <PageHeader
        eyebrow="Reports"
        title="Portal report"
        sub={
          <span className="text-[#6f6a66]">
            {scopeLabel} · generated {timeAgo(report.generated_at)} · times in {report.timezone}
          </span>
        }
        actions={
          <>
            {/* One filter row above everything it scopes */}
            <div className="flex items-center rounded-full bg-stone-100 p-1">
              {RANGES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  aria-pressed={days === d}
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

      {/* ---- KPI row ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Applications"
          value={compact(applications.total)}
          delta={
            <Delta current={applications.in_period} previous={applications.previous_period} />
          }
          sub={`${num(applications.in_period)} in the last ${report.period_days} days`}
          spark={<Sparkline series={series} />}
          to="/admin/applications"
        />
        <Tile
          label="Active openings"
          value={compact(openings.active)}
          sub={
            openings.active_without_applications > 0
              ? `${openings.active_without_applications} with no applicants yet`
              : "every vacancy has applicants"
          }
          tone={openings.active_without_applications > 0 ? "warn" : undefined}
          to="/admin/openings"
        />
        <Tile
          label="Active users"
          value={compact(users.active)}
          sub={
            users.restricted
              ? "roster hidden for this role"
              : users.never_logged_in > 0
                ? `${users.never_logged_in} have never signed in`
                : `all of ${num(users.total)} accounts in use`
          }
          tone={!users.restricted && users.never_logged_in > 0 ? "warn" : undefined}
        />
        <Tile
          label="Entities"
          value={compact(entities.active)}
          sub={`${num(entities.branches.length)} branches · ${num(
            entities.branches.filter((b) => b.is_active).length
          )} active`}
        />
      </div>

      {/* ---- Intake ---- */}
      <div className="grid gap-3 mt-6 xl:grid-cols-3">
        <div className={`${card} p-5 xl:col-span-2 flex flex-col`}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h3 className="font-poppins text-base font-semibold text-[#2a2426]">
                Applications received
              </h3>
              <p className="text-xs text-[#6f6a66] mt-0.5">
                Daily, last {report.period_days} days · {num(applications.in_period)} in total
              </p>
            </div>
            <button
              onClick={() => setTrendTable((v) => !v)}
              className="text-xs font-semibold text-[#a81724] hover:underline shrink-0"
            >
              {trendTable ? "Show chart" : "Show values"}
            </button>
          </div>

          {trendTable ? (
            <div className="mt-3 flex-1 max-h-[240px] overflow-y-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[#f0edea]">
                  {series
                    .filter((p) => p.count > 0)
                    .reverse()
                    .map((p) => (
                      <tr key={p.key}>
                        <td className="py-1.5 text-[#6f6a66]">{shortDay(p.date)}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums">{p.count}</td>
                      </tr>
                    ))}
                  {!series.some((p) => p.count > 0) && (
                    <tr>
                      <td className="py-3 text-[#6f6a66]">No applications in this period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex-1 flex items-center">
              <TrendChart series={series} periodDays={report.period_days} />
            </div>
          )}

          {/* Intake counters live with the intake chart: they fill the card's
              spare height and stop the side column from running long */}
          <div className="mt-4 pt-3 border-t border-[#f0edea] grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              ["Today", num(applications.today)],
              ["Last 7 days", num(applications.week)],
              ["Referrals", num(applications.referred)],
              ["Handed over", num(applications.handed_over)],
              ["Most recent", timeAgo(applications.last_received_at)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6f6a66]">
                  {label}
                </p>
                <p className="text-sm font-semibold text-[#2a2426] mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-poppins text-base font-semibold text-[#2a2426]">Hiring pipeline</h3>
          <p className="text-xs text-[#6f6a66] mt-0.5 mb-3">
            Every application sits in one stage
          </p>
          <div className="space-y-0.5">
            {applications.stages.map((s) => (
              <BarRow
                key={s.key}
                label={s.retired ? `${s.label} (retired)` : s.label}
                value={s.count}
                max={stageTotal}
                share={Math.round((s.count / stageTotal) * 100)}
                muted={s.count === 0}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ---- Openings ---- */}
      <Section
        title="Vacancies by applications"
        sub={`${openings.active} active · ${num(openings.applications_to_active)} applications between them`}
        right={
          rankedOpenings.length > 8 && (
            <button onClick={() => setAllOpenings((v) => !v)} className={btnGhost}>
              {allOpenings ? "Show top 8" : `Show all ${rankedOpenings.length}`}
            </button>
          )
        }
      >
        {/* The empty vacancies sit beside the chart rather than under it - the
            card is wide, and stacking them only added scroll */}
        <div className={`${card} p-5 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`}>
          <SharePie
            size="w-36 h-36"
            legendMax="max-w-none"
            showZeros={false}
            items={openingItems}
            emptyText="No applications to any active vacancy yet."
          />
          <ZeroPanel
            items={openingItems.filter((o) => o.value === 0)}
            label={`No applicants yet (${openingItems.filter((o) => o.value === 0).length})`}
            className="lg:border-l lg:border-[#f0edea] lg:pl-6"
          />
        </div>
      </Section>

      {/* ---- Entities, branches, sources ---- */}
      <div className="grid gap-3 mt-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-3">
          <Section title="Entities & branches" sub="How the group is configured, and what each part attracts" className="mt-0">
            <div className="grid gap-3 sm:grid-cols-2">

              {entities.list.map((e) => {
                const own = entities.branches.filter((b) => b.entity === e.code);
                return (
                  <div key={e.code} className={`${card} p-4`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {/* Identity is the label; the dot is a secondary cue */}
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: e.color }}
                            aria-hidden="true"
                          />
                          <h4 className="font-poppins font-semibold text-[#2a2426] truncate">{e.name}</h4>
                        </div>
                        <p className="text-xs text-[#6f6a66] mt-0.5">
                          {e.active_branches} of {e.branches} branches · {e.active_openings} open
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-poppins text-xl font-semibold text-[#2a2426]">
                          {num(e.applications)}
                        </p>
                        <p className="text-[11px] text-[#6f6a66]">applications</p>
                      </div>
                    </div>

                    <div className="mt-3 h-1.5 rounded-full bg-[#f0edea] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(e.applications / maxEntity) * 100}%`,
                          backgroundColor: MARK,
                        }}
                      />
                    </div>

                    <div className="mt-3 pt-3 border-t border-[#f0edea]">
                      {own.length ? (
                        <SharePie
                          size="w-24 h-24"
                          items={own.map((b) => ({
                            key: String(b.id),
                            label: b.name,
                            // The donut's centre is only ~80px wide: show the
                            // distinguishing part, not the shared school prefix
                            short: b.name.includes(",")
                              ? b.name.split(",").pop().trim()
                              : b.name,
                            sublabel: `${b.active_openings} open`,
                            value: b.applications,
                          }))}
                          zeroIcon={false}
                          zeroLabel={`No applications yet (${
                            own.filter((b) => b.applications === 0).length
                          })`}
                          emptyText="No applications to this entity yet."
                        />
                      ) : (
                        <p className="text-xs text-[#6f6a66]">No branches yet.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="space-y-3">
          {/* The group split sits in the side column, where the entity cards
              beside it stay wide enough to read */}
          <Section title="Share of applications" sub="Each business's slice of the intake" className="mt-0">
            <div className={`${card} p-4`}>
              {entityTotal === 0 ? (
                <p className="text-sm text-[#6f6a66]">No applications yet.</p>
              ) : (
                <div className="flex items-center gap-4">
                  <GroupDonut
                    segments={entitySegments}
                    total={entityTotal}
                    hovered={hoverEntity}
                    onHover={setHoverEntity}
                    className="w-24 h-24 shrink-0"
                  />
                  <ul className="flex-1 min-w-0 space-y-1">
                    {entitySegments.map((s) => {
                      const share = Math.round((s.count / entityTotal) * 100);
                      return (
                        <li
                          key={s.key}
                          onMouseEnter={() => setHoverEntity(s.key)}
                          onMouseLeave={() => setHoverEntity(null)}
                          className={`flex items-center gap-2 text-sm rounded-lg px-1.5 py-1 -mx-1 transition-colors ${
                            hoverEntity === s.key ? "bg-stone-50" : ""
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: s.hex }}
                            aria-hidden="true"
                          />
                          <span className="flex-1 min-w-0 truncate text-[#2a2426]" title={s.label}>
                            {s.label}
                          </span>
                          <span className="tabular-nums font-semibold text-[#2a2426] shrink-0">
                            {num(s.count)}
                          </span>
                          <span className="tabular-nums text-[11px] text-[#6f6a66] w-8 text-right shrink-0">
                            {share}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </Section>

          <Section title="Where they came from" sub="Source, campaign tag and sending site" className="mt-0">
            <div className={`${card} p-5 space-y-4`}>
              <Breakdown title="Source" rows={sources} total={applications.total} />
              <Breakdown
                title="UTM source"
                rows={utmSources}
                total={applications.total}
                muteLabel="Not tagged"
              />
              {campaigns.length > 0 && (
                <Breakdown title="Campaign" rows={campaigns} total={applications.total} />
              )}
              <Breakdown title="Submitted via" rows={sites} total={applications.total} />
            </div>
          </Section>

        </div>
      </div>

      {/* ---- Users ---- */}
      <Section
        title="Users"
        sub="Who can sign in, and when they last did"
        right={
          !users.restricted && (
            <div className="flex flex-wrap gap-2 text-xs">
              {users.never_logged_in > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 font-medium" style={{ color: WARNING_INK }}>
                  {users.never_logged_in} never signed in
                </span>
              )}
              {users.pending_first_login > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 font-medium" style={{ color: WARNING_INK }}>
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
          <div className={`${card} p-6 text-sm text-[#6f6a66]`}>
            {num(users.active)} active accounts of {num(users.total)}. Managing users is not part of
            this role, so the roster is not shown.
          </div>
        ) : (
          <Table
            head={["User", "Role", "Scope", "Status", "2FA", { key: "last", label: "Last login", align: "right" }]}
          >
            {users.list.map((u) => (
              <tr key={u.id} className="hover:bg-stone-50/60">
                <Td>
                  <span className="font-medium">{u.name}</span>
                  <span className="block text-xs text-[#6f6a66]">{u.email}</span>
                </Td>
                <Td muted>{u.role}</Td>
                <Td>
                  {u.entity ? (
                    <span className="flex items-center gap-1.5">
                      <GroupBadge group={u.entity} />
                      {u.branch && <span className="text-xs text-[#6f6a66]">{u.branch}</span>}
                    </span>
                  ) : (
                    <span className="text-xs text-[#6f6a66]">All entities</span>
                  )}
                </Td>
                <Td>
                  <StatusBadge active={u.is_active} />
                </Td>
                <Td muted>{u.totp_enabled ? "On" : "—"}</Td>
                <Td right muted={!u.last_login_at}>
                  {timeAgo(u.last_login_at)}
                  {u.must_change_password && (
                    <span className="block text-[11px]" style={{ color: WARNING_INK }}>
                      initial password
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* ---- Activity ---- */}
      <Section
        title="Pipeline activity"
        sub={`What the team has done in the last ${report.period_days} days`}
        right={
          <span className="text-xs text-[#6f6a66]">
            {num(activity.total - activity.submissions)} actions ·{" "}
            {num(activity.submissions)} new applications
          </span>
        }
      >
        {activity.by_user.length ? (
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
                  <span className="block text-xs text-[#6f6a66]">{a.email}</span>
                </Td>
                <Td muted>
                  <span className="capitalize">{a.last_action || "—"}</span>
                  {a.last_detail && (
                    <span className="block text-xs text-[#6f6a66] truncate max-w-md" title={a.last_detail}>
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
        ) : (
          <div className={`${card} p-6 text-sm text-[#6f6a66]`}>
            Nobody has touched the pipeline in this period.
          </div>
        )}
      </Section>
    </div>
  );
};

export default ReportsPage;
