import React from "react";
import logoDps from "../assets/logo-dps.png";
import logoPallavi from "../assets/logo-pallavi.png";

// Shared design tokens + tiny building blocks for the admin panel.
// Flat professional theme: sans-serif type, crisp 1px borders, no shadows,
// small radii, flat blue accent for interactive states.

export const INK = "#2a2426";
export const CREAM = "#f4f3f1";
export const LINE = "#e7e4e1";
export const ACCENT = "#a81724";

// Bundled logos, by entity code. An entity without one keeps the initials
// avatar, so adding an entity in the admin UI never leaves a broken image.
const GROUP_LOGOS = {
  DPS: logoDps,
  Pallavi: logoPallavi,
};

export const groupLogo = (code) => GROUP_LOGOS[code] || null;

// Entity registry - no hardcoded entities. Filled from /admin/entities
// via registerEntities(); unknown codes fall back to a neutral look.
export const GROUP_META = {};

export const registerEntities = (entities = []) => {
  entities.forEach((e) => {
    GROUP_META[e.code] = {
      label: e.name,
      short: e.code,
      hex: e.color || INK,
      logo: groupLogo(e.code),
    };
  });
};

// Meta for any entity code, with a neutral fallback for unknown codes
export const groupMeta = (code) =>
  GROUP_META[code] || {
    label: code || "—",
    short: code || "—",
    hex: INK,
    logo: groupLogo(code),
  };

// Class strings -------------------------------------------------------------

export const btnDark =
  "inline-flex items-center gap-2 bg-[#a81724] hover:bg-[#871119] text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-colors disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed";

export const btnGhost =
  "inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-full border border-[#d8d3cf] bg-white text-stone-600 hover:bg-stone-50 transition-colors";

export const inputBase =
  "border border-[#d8d3cf] bg-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724] transition-shadow";

export const thBase =
  "px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-stone-600 bg-stone-50 whitespace-nowrap";

export const card = "bg-white border border-[#e7e4e1] rounded-2xl";

// Components ----------------------------------------------------------------

export const Eyebrow = ({ children }) => (
  <p className="text-[11px] font-inter font-semibold uppercase tracking-[0.14em] text-[#a81724]">
    {children}
  </p>
);

export const PageHeader = ({ eyebrow, title, sub, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-poppins text-2xl sm:text-3xl font-semibold text-[#2a2426] mt-1">
        {title}
      </h2>
      {sub && <div className="text-sm mt-1.5">{sub}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-3 shrink-0">{actions}</div>}
  </div>
);

export const GroupBadge = ({ group }) => {
  if (!group) return null;
  const meta = groupMeta(group);
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full border text-[9px] font-semibold uppercase tracking-[0.12em]"
      style={{
        color: meta.hex,
        borderColor: `${meta.hex}33`,
        backgroundColor: `${meta.hex}0d`,
      }}
    >
      {meta.short}
    </span>
  );
};

export const StatusBadge = ({ active, onLabel = "Active", offLabel = "Inactive" }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
      active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"
    }`}
  >
    <span
      className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-stone-400"}`}
    />
    {active ? onLabel : offLabel}
  </span>
);

export const Avatar = ({ name, group }) => {
  const meta = GROUP_META[group];
  const initials = String(name || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
      style={{
        color: meta ? meta.hex : INK,
        backgroundColor: meta ? `${meta.hex}12` : `${INK}12`,
      }}
    >
      {initials}
    </span>
  );
};

// Icon buttons ----------------------------------------------------------------

export const ICON_PATHS = {
  edit: "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z",
  trash:
    "M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6",
  power: "M18.36 6.64a9 9 0 1 1-12.72 0 M12 2v10",
};

const ICON_TONES = {
  neutral: "text-stone-500 hover:text-[#2a2426] hover:border-[#a8a29e]",
  danger: "text-[#dc2626] border-[#dc2626]/25 hover:bg-[#dc2626] hover:border-[#dc2626] hover:text-white",
  success:
    "text-emerald-600 border-emerald-600/25 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white",
};

// Icon-only action button; `title` doubles as the tooltip and accessible name
export const IconButton = ({ icon, title, tone = "neutral", onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={title}
    disabled={disabled}
    className={`inline-flex items-center justify-center w-8 h-8 rounded-full border border-[#e7e4e1] bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      ICON_TONES[tone] || ICON_TONES.neutral
    }`}
  >
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[icon] || icon} />
    </svg>
  </button>
);

// Pagination -----------------------------------------------------------------

// Compact page list: 1 … around current … last
const pageWindow = (current, total) => {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of list) {
    if (p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
};

export const Pagination = ({ page, totalPages, onPage, totalItems, pageSize }) => {
  if (!totalPages || totalPages <= 1) return null;
  const showRange = totalItems != null && pageSize != null;
  const start = (page - 1) * (pageSize || 0) + 1;
  const end = Math.min(page * (pageSize || 0), totalItems || 0);
  const navBtn =
    "w-9 h-9 rounded-full text-sm font-medium border flex items-center justify-center transition-colors";
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
      <p className="font-mono text-[11px] text-[#948d88]">
        {showRange ? `${start}–${end} of ${totalItems}` : `Page ${page} of ${totalPages}`}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
          aria-label="Previous page"
          className={`${navBtn} ${
            page === 1
              ? "text-stone-300 border-[#efece9] cursor-not-allowed"
              : "text-stone-600 border-[#e7e4e1] bg-white hover:border-[#a81724]/40"
          }`}
        >
          ←
        </button>
        {pageWindow(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="w-7 text-center text-[#948d88] select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              className={`${navBtn} font-semibold ${
                page === p
                  ? "bg-[#a81724] text-white border-[#a81724]"
                  : "text-stone-600 border-[#e7e4e1] bg-white hover:border-[#a81724]/40"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          aria-label="Next page"
          className={`${navBtn} ${
            page === totalPages
              ? "text-stone-300 border-[#efece9] cursor-not-allowed"
              : "text-stone-600 border-[#e7e4e1] bg-white hover:border-[#a81724]/40"
          }`}
        >
          →
        </button>
      </div>
    </div>
  );
};

// Client-side pagination for already-loaded lists
export const usePagination = (items, pageSize = 10) => {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = items.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { page: safePage, setPage, totalPages, paged, pageSize, total: items.length };
};

// Data helpers ---------------------------------------------------------------

// SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC
export const parseDbDate = (s) => {
  if (!s) return null;
  const iso = String(s).includes("T") ? String(s) : `${String(s).replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDate = (s) => {
  const d = parseDbDate(s);
  if (!d) return s || "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const formatTime = (s) => {
  const d = parseDbDate(s);
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", { hour12: false });
};

// "9182472279" -> "91824 72279"
export const formatMobile = (m) => {
  const digits = String(m || "").replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : m || "—";
};

// Charts ----------------------------------------------------------------------

// Donut chart for group share; center label lives in an overlay so it stays
// upright. Controlled hover so callers can link it to a legend.
const DONUT_R = 45;
const DONUT_C = 2 * Math.PI * DONUT_R;

export const GroupDonut = ({ segments, total, hovered, onHover, className = "w-36 h-36" }) => {
  const visible = segments.filter((s) => s.count > 0);
  // 2px surface gap between slices, only when there is more than one slice
  const gap = visible.length > 1 ? 2.5 : 0;
  let acc = 0;
  const active = hovered ? segments.find((s) => s.key === hovered) : null;
  return (
    <div className={`relative shrink-0 ${className}`}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={DONUT_R} fill="none" stroke="#f0edea" strokeWidth="14" />
        {visible.map((s) => {
          const len = total ? (s.count / total) * DONUT_C : 0;
          const dash = Math.max(0.5, len - gap);
          const el = (
            <circle
              key={s.key}
              cx="60"
              cy="60"
              r={DONUT_R}
              fill="none"
              stroke={s.hex}
              strokeWidth={hovered === s.key ? 17 : 14}
              strokeDasharray={`${dash} ${DONUT_C - dash}`}
              strokeDashoffset={-(acc + gap / 2)}
              className="transition-all duration-200 cursor-pointer"
              onMouseEnter={() => onHover && onHover(s.key)}
              onMouseLeave={() => onHover && onHover(null)}
            />
          );
          acc += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="font-poppins text-2xl font-semibold text-[#2a2426] leading-none">
          {active ? active.count : total}
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#948d88] mt-1 max-w-[80px] truncate">
          {active ? active.short : "Total"}
        </p>
      </div>
    </div>
  );
};

// Expand sparse {day, count} rows into a dense last-N-days series.
//
// The server buckets by calendar day in APP_TIMEZONE (Asia/Kolkata), so the
// keys here have to be built the same way. Using toISOString() meant UTC keys:
// between 00:00 and 05:30 IST the current day's bucket was never looked up, so
// the chart and its period total disagreed with the "today" figure every night.
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.REACT_APP_TIMEZONE || 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
// en-CA already formats as YYYY-MM-DD; formatToParts keeps it robust regardless
const localDayKey = (date) => {
  const parts = dayKeyFormatter.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const buildDailySeries = (byDay = [], n = 90) => {
  const map = {};
  byDay.forEach((r) => {
    map[r.day] = r.count;
  });
  const series = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = localDayKey(d);
    series.push({ key, date: d, count: map[key] || 0 });
  }
  return series;
};
