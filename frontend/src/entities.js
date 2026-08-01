import logoDps from "./assets/dps-logo.png";
import logoPallavi from "./assets/pgos-logo.png";

// URL slug -> entity code stored in the database
const SLUG_TO_CODE = {
  dps: "DPS",
  pgos: "Pallavi",
  pallavi: "Pallavi",
};

// Branding for each entity code (logo files ship with the frontend)
export const ENTITY_BRANDING = {
  DPS: {
    code: "DPS",
    name: "Delhi Public Schools",
    logo: logoDps,
    slug: "dps",
  },
  Pallavi: {
    code: "Pallavi",
    name: "Pallavi Group of Schools",
    logo: logoPallavi,
    slug: "pgos",
  },
};

// Resolve a landing-page slug (/dps, /pgos) to its entity branding, or null.
//
// `known` is the live entity list from /api/entities. Entities added in the
// admin panel have no bundled logo or hand-written slug, so they fall back to
// a slugified code and the shared branding: without this they appear in the
// job list but their own landing page redirects to "/".
export const resolveEntity = (slug, known = []) => {
  if (!slug) return null;
  const wanted = String(slug).toLowerCase();

  const code = SLUG_TO_CODE[wanted];
  if (code && ENTITY_BRANDING[code]) return ENTITY_BRANDING[code];

  const match = known.find(
    (e) =>
      e.is_active !== 0 &&
      (String(e.code).toLowerCase() === wanted ||
        slugify(e.code) === wanted ||
        slugify(e.name) === wanted)
  );
  if (!match) return null;

  return (
    ENTITY_BRANDING[match.code] || {
      code: match.code,
      name: match.name,
      // No bundled asset for an entity created after this build
      logo: null,
      slug: slugify(match.code),
      color: match.color,
    }
  );
};

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
