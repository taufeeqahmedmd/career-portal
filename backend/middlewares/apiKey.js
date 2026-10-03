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
//
// The reporting feed (/api/data) uses requireReportingKey instead: there the
// key is mandatory, and it must be a reporting key. Each kind is refused on the
// other's endpoint.

const { findByKey, touch } = require('../utils/apiKeys');
const { fail, oneError, CODES } = require('../utils/errors');

const readKey = (req) => {
  const header = req.get('X-API-Key');
  if (header) return header.trim();
  const auth = req.get('Authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  return bearer ? bearer[1].trim() : '';
};

const keyError = (status, code, message) => ({
  status,
  error: oneError('api_key', code, message),
});

// The checks every key passes whatever it is used for. Returns the failure to
// send, or null when the key is usable.
function checkKey(key, kind) {
  if (!key) return keyError(401, CODES.UNAUTHORIZED, 'The API key is not recognised.');
  if (!key.is_active || key.revoked_at) {
    return keyError(401, CODES.UNAUTHORIZED, 'This API key has been revoked.');
  }
  // A key outlives the entity it was issued for; that entity being switched off
  // should stop the key rather than let it through unscoped
  if (key.entity_code && key.entity_active !== 1) {
    return keyError(403, CODES.FORBIDDEN, 'The business this key belongs to is not active.');
  }
  if ((key.kind || 'submit') !== kind) {
    return kind === 'reporting'
      ? keyError(
          403,
          CODES.FORBIDDEN,
          'This key is for submitting applications and cannot read data. Ask for a reporting key.'
        )
      : keyError(
          403,
          CODES.FORBIDDEN,
          'This key is a read-only reporting key and cannot submit applications.'
        );
  }
  return null;
}

// Looks the presented key up and vets it for `kind`. Sends the failure itself
// and resolves to null when the request must stop there.
async function resolveKey(res, presented, kind) {
  const key = await findByKey(presented);
  const problem = checkKey(key, kind);
  if (problem) {
    fail(res, problem.status, problem.error);
    return null;
  }
  await touch(key);
  return {
    id: key.id,
    name: key.name,
    kind,
    entity_code: key.entity_code || null,
    rate_limit_per_hour: key.rate_limit_per_hour,
  };
}

async function attachApiKey(req, res, next) {
  const presented = readKey(req);
  req.apiKey = null;
  if (!presented) return next();

  try {
    const key = await resolveKey(res, presented, 'submit');
    if (!key) return;
    req.apiKey = key;
  } catch (err) {
    return next(err);
  }
  next();
}

// The data feed holds every candidate's personal details, so there is no
// anonymous path: no key, no data.
async function requireReportingKey(req, res, next) {
  const presented = readKey(req);
  req.apiKey = null;
  if (!presented) {
    return fail(
      res,
      401,
      oneError(
        'api_key',
        CODES.UNAUTHORIZED,
        'Send your reporting API key in the X-API-Key header.'
      )
    );
  }

  try {
    const key = await resolveKey(res, presented, 'reporting');
    if (!key) return;
    req.apiKey = key;
  } catch (err) {
    return next(err);
  }
  next();
}

module.exports = { attachApiKey, requireReportingKey };
