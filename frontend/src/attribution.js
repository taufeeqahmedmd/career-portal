// Captures where a visitor came from (UTM tags, ad click ids) the first time
// they land, and keeps it for the tab so it can be sent with the application.
//
// First-touch wins: once a session has tracking data, later navigation inside
// the site cannot overwrite it.

const KEY = "careers_attribution";

const TRACKED = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
];

// Our own page params - not campaign data
const OWN_PARAMS = ["branch", "position"];

const read = () => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const write = (value) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {}
};

export const captureAttribution = () => {
  const existing = read();

  const params = new URLSearchParams(window.location.search);
  const all = {};
  params.forEach((value, key) => {
    all[key] = value;
  });

  const hasTracking = TRACKED.some((k) => all[k]);
  // Keep the original source once one is known
  if (existing && (existing.__tracked || !hasTracking)) return existing;

  const captured = { __tracked: hasTracking, captured_at: new Date().toISOString() };
  TRACKED.forEach((k) => {
    if (all[k]) captured[k] = all[k];
  });

  // Anything else on the URL is kept for analysis, never shown in the admin UI.
  // The empty key comes from the bare `?=value` branch-filter form, not a campaign.
  const extra = {};
  Object.entries(all).forEach(([k, v]) => {
    if (k && !TRACKED.includes(k) && !OWN_PARAMS.includes(k)) extra[k] = v;
  });
  if (Object.keys(extra).length) captured.extra = extra;

  captured.landing_page = `${window.location.pathname}${window.location.search}`;
  if (document.referrer) captured.referrer = document.referrer;

  write(captured);
  return captured;
};

// Serialised for the application form; empty string when nothing was captured
export const getAttribution = () => {
  const stored = read() || captureAttribution();
  if (!stored) return "";
  const { __tracked, ...rest } = stored;
  return JSON.stringify(rest);
};
