// Turns the tracking data captured on the careers site into the columns stored
// with an application. Only `source` is shown in the admin UI; everything else
// is kept for later analysis straight from the database.

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const CLICK_IDS = ['gclid', 'fbclid'];

// Common ad/social sources get a proper display name
const KNOWN = {
  google: 'Google',
  googleads: 'Google Ads',
  google_ads: 'Google Ads',
  adwords: 'Google Ads',
  facebook: 'Facebook',
  fb: 'Facebook',
  meta: 'Meta',
  instagram: 'Instagram',
  ig: 'Instagram',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  youtube: 'YouTube',
  twitter: 'X (Twitter)',
  x: 'X (Twitter)',
  telegram: 'Telegram',
  email: 'Email',
  newsletter: 'Newsletter',
  sms: 'SMS',
  naukri: 'Naukri',
  indeed: 'Indeed',
  referral: 'Referral',
  bing: 'Bing',
};

const prettify = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (KNOWN[key]) return KNOWN[key];
  if (KNOWN[key.replace(/_/g, '')]) return KNOWN[key.replace(/_/g, '')];
  // Fall back to the raw value, title-cased
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// Paid click ids win: they are proof of an ad click even without UTMs
function deriveSource({ gclid, fbclid, utm_source, utm_medium }) {
  if (gclid) return 'Google Ads';
  if (fbclid) return 'Meta Ads';
  if (utm_source) {
    const label = prettify(utm_source);
    const medium = String(utm_medium || '').toLowerCase();
    if (/^(cpc|ppc|paid|paid_social|paidsocial)$/.test(medium) && !/ads$/i.test(label)) {
      return `${label} Ads`;
    }
    return label;
  }
  return 'Website';
}

// `payload` is whatever the careers site captured (already parsed)
function buildAttribution(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const clean = (v) => String(v == null ? '' : v).trim().slice(0, 255);

  const fields = {};
  UTM_KEYS.forEach((k) => {
    fields[k] = clean(data[k]);
  });
  CLICK_IDS.forEach((k) => {
    fields[k] = clean(data[k]);
  });

  // Everything else worth keeping, but never shown in the UI
  const extras = {};
  if (data.extra && typeof data.extra === 'object') {
    Object.entries(data.extra)
      .slice(0, 30)
      .forEach(([k, v]) => {
        const key = String(k).slice(0, 60);
        if (!UTM_KEYS.includes(key) && !CLICK_IDS.includes(key)) extras[key] = clean(v);
      });
  }
  ['landing_page', 'referrer', 'captured_at'].forEach((k) => {
    if (data[k]) extras[k] = clean(data[k]);
  });

  return {
    ...fields,
    source: deriveSource(fields),
    tracking_params: Object.keys(extras).length ? JSON.stringify(extras) : '',
  };
}

module.exports = { buildAttribution, deriveSource, UTM_KEYS, CLICK_IDS };
