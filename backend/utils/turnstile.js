// Cloudflare Turnstile - server-side verification of the widget token.
// The browser token proves nothing on its own; it only counts once Cloudflare
// has confirmed it here, and every token is single-use.
//
// Env: TURNSTILE_SECRET_KEY (backend), REACT_APP_TURNSTILE_SITE_KEY (frontend).
// With no secret key configured the check is skipped, so local development and
// existing deployments keep working until the keys are added.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = Number(process.env.TURNSTILE_TIMEOUT_MS || 8000);

const isConfigured = () => !!process.env.TURNSTILE_SECRET_KEY;

// Cloudflare's error codes, translated for the person filling in the form
const MESSAGES = {
  'missing-input-response': 'Please complete the security check.',
  'invalid-input-response': 'The security check expired. Please try again.',
  'timeout-or-duplicate': 'The security check expired. Please try again.',
  'invalid-widget-id': 'The security check is misconfigured. Please contact the administrator.',
  'invalid-input-secret': 'The security check is misconfigured. Please contact the administrator.',
  'missing-input-secret': 'The security check is misconfigured. Please contact the administrator.',
};

// Resolves { ok: true } or { ok: false, error, codes }
async function verifyCaptcha(token, remoteIp) {
  if (!isConfigured()) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string') {
    return { ok: false, error: MESSAGES['missing-input-response'] };
  }

  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (remoteIp) body.append('remoteip', remoteIp);

  let data;
  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    data = await response.json();
  } catch (err) {
    // Cloudflare unreachable. Failing closed would lock everyone out of the
    // portal during an outage, so the request is allowed through and logged.
    console.error('Turnstile verification unreachable:', err.message);
    return { ok: true, degraded: true };
  }

  if (data?.success) return { ok: true };

  const codes = data?.['error-codes'] || [];
  const known = codes.find((c) => MESSAGES[c]);
  return {
    ok: false,
    codes,
    error: known ? MESSAGES[known] : 'Security check failed. Please try again.',
  };
}

// Route guard: reads the token from the body (JSON or multipart) or a header
function requireCaptcha(req, res, next) {
  const token =
    req.body?.captcha_token ||
    req.body?.['cf-turnstile-response'] ||
    req.headers['cf-turnstile-response'];

  verifyCaptcha(token, req.ip)
    .then((result) => {
      if (result.ok) return next();
      res.status(400).json({ error: result.error, code: 'captcha_failed' });
    })
    .catch(next);
}

module.exports = { verifyCaptcha, requireCaptcha, isConfigured };
