// Identifies the site behind a request to the public API.
//
// The key is OPTIONAL. The careers portal's own form has never sent one and
// still does not: without a key a request behaves exactly as before - captcha
// required, rate limited by IP. Presenting a valid key instead identifies the
// caller, which buys three things a browser form cannot have:
//
//   1. its own rate limit, so one busy site cannot exhaust another's budget
//      (and a site that posts server-side is not capped as a single IP)
//   2. captcha exemption, since a server has no browser to solve one in
//   3. an entity lock, so a key issued to one business cannot file
//      applications against another's openings
//
// An *invalid* key is always rejected. Sending a wrong key is a mistake worth
// surfacing, never something to silently downgrade to the anonymous path.

const { findByKey, touch } = require('../utils/apiKeys');
const { fail, oneError, CODES } = require('../utils/errors');

const readKey = (req) => {
  const header = req.get('X-API-Key');
  if (header) return header.trim();
  const auth = req.get('Authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  return bearer ? bearer[1].trim() : '';
};

async function attachApiKey(req, res, next) {
  const presented = readKey(req);
  req.apiKey = null;
  if (!presented) return next();

  let key;
  try {
    key = await findByKey(presented);
  } catch (err) {
    return next(err);
  }

  if (!key) {
    return fail(
      res,
      401,
      oneError('api_key', CODES.UNAUTHORIZED, 'The API key is not recognised.')
    );
  }
  if (!key.is_active || key.revoked_at) {
    return fail(
      res,
      401,
      oneError('api_key', CODES.UNAUTHORIZED, 'This API key has been revoked.')
    );
  }
  // A key outlives the entity it was issued for; that entity being switched off
  // should stop its submissions rather than let them through unscoped
  if (key.entity_code && key.entity_active !== 1) {
    return fail(
      res,
      403,
      oneError('api_key', CODES.FORBIDDEN, 'The business this key belongs to is not active.')
    );
  }

  req.apiKey = {
    id: key.id,
    name: key.name,
    entity_code: key.entity_code || null,
    rate_limit_per_hour: key.rate_limit_per_hour,
  };
  await touch(key);
  next();
}

module.exports = { attachApiKey };
