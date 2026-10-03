// The forgot-password flow with the captcha switched on.
//
// The rest of the suite boots with TURNSTILE_SECRET_KEY empty, which skips
// verification entirely - so every captcha-guarded endpoint passed here while
// being unreachable in a deployment that actually sets the key. These cases
// boot the server in the posture production runs in.
//
// Only the "no token supplied" path is exercised: it is decided before any
// call to Cloudflare, so the suite stays offline and deterministic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, request, ADMIN_EMAIL } = require('./helpers');

test.before(() => startServer({ TURNSTILE_SECRET_KEY: 'test-secret-never-reaches-cloudflare' }));
test.after(stopServer);

test('the public config advertises that the captcha is on', async () => {
  const res = await request('/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.captcha_enabled, true);
});

test('requesting a reset code without a captcha token is refused', async () => {
  const res = await request('/admin/forgot-password', {
    method: 'POST',
    body: { email: ADMIN_EMAIL },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'captcha_failed');
});

// The bug this file was written for: the reset step verifies a captcha token
// like the two steps before it, so the client has to send one. It did not, and
// every reset failed at the last step - after the code had already been
// emailed, which is why it read as "the OTP arrives but nothing happens".
test('redeeming a reset code carries a captcha token like every other step', async () => {
  const res = await request('/admin/reset-password', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, code: '123456', new_password: 'NotTheRealOne123' },
  });

  // A missing token must be reported as a captcha problem and nothing else -
  // if this ever comes back as a bad-code error, the client is being told to
  // re-enter a code that was never the reason it failed
  assert.equal(res.status, 400);
  assert.equal(
    res.body.code,
    'captcha_failed',
    'the reset endpoint must state plainly that the captcha, not the code, was missing'
  );
});

// Field-name contract. The client sends `captcha_token`; if the server ever
// reads a different key, every submission fails as "missing" with the widget
// plainly filled in on screen.
test('the captcha field is named captcha_token on every guarded endpoint', async () => {
  for (const [path, body] of [
    ['/admin/login', { email: ADMIN_EMAIL, password: 'irrelevant' }],
    ['/admin/forgot-password', { email: ADMIN_EMAIL }],
    ['/admin/reset-password', { email: ADMIN_EMAIL, code: '123456', new_password: 'Irrelevant123' }],
  ]) {
    const withWrongName = await request(path, {
      method: 'POST',
      body: { ...body, captchaToken: 'camel-case-is-not-the-contract' },
    });
    assert.equal(
      withWrongName.body.code,
      'captcha_failed',
      `${path} must not accept a differently named captcha field`
    );
  }
});
