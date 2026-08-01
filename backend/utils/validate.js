// Route ids must be positive integers. Anything else (NaN, "abc", 1.5) would
// reach PostgreSQL and raise `invalid input syntax for type integer` - a 500
// where the caller deserves a 404.
const validId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : -1;
};

// `YYYY-MM-DD` only, and it has to be a real calendar date
const isValidDate = (value) => {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// `%` and `_` are LIKE wildcards - escape them so a search for "%" is literal
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);

// Accepts real booleans and the usual string spellings; anything else is false
const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
};

// Trim any input safely, including numbers/objects that have no .trim()
const str = (value) => String(value == null ? '' : value).trim();

module.exports = { validId, isValidDate, escapeLike, toBool, str };
