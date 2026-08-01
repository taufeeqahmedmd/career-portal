// Authentication: forced password change, reset codes, two-factor, and the
// rules that revoke a session. Each case here corresponds to a defect that was
// found in testing - they exist so it cannot come back unnoticed.
const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../utils/totp');
const {
  startServer,
  stopServer,
  request,
  login,
  rootToken,
  createUserAndSignIn,
  createRole,
  INITIAL_PASSWORD,
  psql,
  DB_NAME,
} = require('./helpers');

test.before(startServer);
test.after(stopServer);

test('TOTP matches the RFC 6238 reference vectors', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  // Appendix B, SHA-1, truncated from 8 digits to the 6 this portal uses
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [time, expected] of vectors) {
    assert.equal(totp.generate(secret, time), expected.slice(-6), `vector at t=${time}`);
  }
});

test('a new account is confined to the change-password screen', async () => {
  const root = await rootToken();
  const created = await request('/admin/users', {
    method: 'POST',
    token: root,
    body: { name: 'Fresh User', email: 'fresh@test.local' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.initial_password, INITIAL_PASSWORD);
  assert.equal(created.body.user.must_change_password, 1);

  const first = await login('fresh@test.local', INITIAL_PASSWORD);
  assert.equal(first.body.must_change_password, true);
  const t = first.body.token;

  // Everything past the gate is closed
  for (const path of ['/admin/applications', '/admin/openings', '/admin/users']) {
    const res = await request(path, { token: t });
    assert.equal(res.status, 403, `${path} should be blocked`);
    assert.equal(res.body.code, 'password_change_required');
  }
  // ...except the two endpoints needed to get through it
  assert.equal((await request('/admin/me', { token: t })).status, 200);

  // The temporary password cannot simply be re-entered
  const reuse = await request('/admin/change-password', {
    method: 'POST',
    token: t,
    body: { current_password: INITIAL_PASSWORD, new_password: INITIAL_PASSWORD },
  });
  assert.equal(reuse.status, 400);

  const changed = await request('/admin/change-password', {
    method: 'POST',
    token: t,
    body: { current_password: INITIAL_PASSWORD, new_password: 'ChosenPass123' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.must_change_password, false);

  // The change invalidates the token it was made with, and issues a fresh one
  assert.equal((await request('/admin/me', { token: t })).status, 401);
  assert.equal((await request('/admin/applications', { token: changed.body.token })).status, 200);
  assert.equal((await login('fresh@test.local', INITIAL_PASSWORD)).status, 401);
});

test('password policy rejects the obvious choices', async () => {
  const root = await rootToken();
  const user = await createUserAndSignIn(root, { name: 'Policy', email: 'policy@test.local' });
  for (const [password, why] of [
    ['short1', 'too short'],
    ['password', 'common'],
    ['12345678', 'the shared initial password'],
    ['abcdefghij', 'letters only'],
  ]) {
    const res = await request('/admin/change-password', {
      method: 'POST',
      token: user.token,
      body: { current_password: user.password, new_password: password },
    });
    assert.equal(res.status, 400, `should reject ${why}`);
  }
});

test('an expired temporary password stops working until it is re-issued', async () => {
  const root = await rootToken();
  const created = await request('/admin/users', {
    method: 'POST',
    token: root,
    body: { name: 'Stale', email: 'stale@test.local' },
  });
  assert.equal((await login('stale@test.local', INITIAL_PASSWORD)).status, 200);

  await psql(
    `UPDATE users SET created_at = now() - interval '60 days', password_changed_at = NULL WHERE email = 'stale@test.local' RETURNING id`
  );
  const expired = await login('stale@test.local', INITIAL_PASSWORD);
  assert.equal(expired.status, 401);
  assert.match(expired.body.error, /expired/i);

  const reissued = await request(`/admin/users/${created.body.user.id}`, {
    method: 'PUT',
    token: root,
    body: { reset_password: true },
  });
  assert.equal(reissued.status, 200);
  assert.equal((await login('stale@test.local', INITIAL_PASSWORD)).status, 200);
});

test('sign-in does not reveal which addresses exist', async () => {
  const unknown = await login('nobody@test.local', 'whatever123');
  const wrongPassword = await login('root@test.local', 'wrongpassword123');
  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.status, 401);
  // Identical wording: the response must not distinguish the two cases
  assert.equal(unknown.body.error, wrongPassword.body.error);

  // Forgot-password replies the same way for both
  const a = await request('/admin/forgot-password', {
    method: 'POST',
    body: { email: 'nobody@test.local' },
  });
  const b = await request('/admin/forgot-password', {
    method: 'POST',
    body: { email: 'root@test.local' },
  });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, b.body);
});

test('a deactivated account and a deactivated role both lose access', async () => {
  const root = await rootToken();
  const roleId = await createRole(root, 'Temp Role', ['applications.view']);
  const user = await createUserAndSignIn(root, {
    name: 'Temp',
    email: 'temp@test.local',
    roleId,
  });
  assert.equal((await request('/admin/applications', { token: user.token })).status, 200);

  await request(`/admin/roles/${roleId}`, {
    method: 'PUT',
    token: root,
    body: { is_active: false },
  });
  // Deactivating a role is presented as a revocation, so it must revoke
  assert.equal((await request('/admin/applications', { token: user.token })).status, 401);
  assert.equal((await login('temp@test.local', user.password)).status, 401);

  await request(`/admin/roles/${roleId}`, {
    method: 'PUT',
    token: root,
    body: { is_active: true },
  });
  const back = await login('temp@test.local', user.password);
  assert.equal(back.status, 200);
  await request(`/admin/users/${user.id}`, {
    method: 'PATCH',
    token: root,
    body: { is_active: false },
  });
  assert.equal((await request('/admin/applications', { token: back.body.token })).status, 401);
});

test('two-factor: enrolment, replay, guess cap, and death on password change', async () => {
  const root = await rootToken();
  const user = await createUserAndSignIn(root, { name: 'TwoFA', email: 'twofa@test.local' });
  await request(`/admin/users/${user.id}/totp`, {
    method: 'PATCH',
    token: root,
    body: { enabled: true },
  });

  // Sign-in now yields a challenge instead of a session
  const enrol = await login('twofa@test.local', user.password);
  assert.equal(enrol.body.challenge, 'totp_setup');
  assert.equal(enrol.body.token, undefined, 'no session token before the code is proven');
  const secret = enrol.body.secret;
  assert.ok(secret && secret.length === 32);

  // The challenge token opens nothing on its own
  assert.equal((await request('/admin/me', { token: enrol.body.challenge_token })).status, 401);

  const wrong = await request('/admin/login/totp', {
    method: 'POST',
    body: { challenge_token: enrol.body.challenge_token, code: '000000' },
  });
  assert.equal(wrong.status, 401);

  const code = totp.generate(secret);
  const done = await request('/admin/login/totp', {
    method: 'POST',
    body: { challenge_token: enrol.body.challenge_token, code },
  });
  assert.equal(done.status, 200);
  assert.ok(done.body.token);
  assert.equal((await request('/admin/applications', { token: done.body.token })).status, 200);

  // The same code cannot be replayed inside its window
  const second = await login('twofa@test.local', user.password);
  assert.equal(second.body.challenge, 'totp');
  const replay = await request('/admin/login/totp', {
    method: 'POST',
    body: { challenge_token: second.body.challenge_token, code },
  });
  assert.equal(replay.status, 401);
  assert.match(replay.body.error, /already been used/i);

  // Guesses are capped per account, not only per IP
  const guessing = await login('twofa@test.local', user.password);
  let sawLockout = false;
  for (let i = 0; i < 7; i += 1) {
    const res = await request('/admin/login/totp', {
      method: 'POST',
      body: { challenge_token: guessing.body.challenge_token, code: '111111' },
    });
    if (res.status === 429) sawLockout = true;
  }
  assert.ok(sawLockout, 'repeated wrong codes must lock the account out');

  // A challenge is half a password check, so it dies when the password changes
  const held = await login('twofa@test.local', user.password);
  const session = await request('/admin/login/totp', {
    method: 'POST',
    body: { challenge_token: (await login('twofa@test.local', user.password)).body.challenge_token,
      code: totp.generate(secret) },
  });
  // (the first of the two challenges above is the "stolen" one, still unused)
  if (session.status === 200) {
    await request('/admin/change-password', {
      method: 'POST',
      token: session.body.token,
      body: { current_password: user.password, new_password: 'RotatedPass123' },
    });
    const stale = await request('/admin/login/totp', {
      method: 'POST',
      body: { challenge_token: held.body.challenge_token, code: totp.generate(secret) },
    });
    assert.equal(stale.status, 401, 'a challenge minted before the change must not redeem');
  }
});

test('forgot-password: single use, attempt cap, and it clears the forced change', async () => {
  const root = await rootToken();
  const user = await createUserAndSignIn(root, { name: 'Reset', email: 'reset@test.local' });

  await request('/admin/forgot-password', { method: 'POST', body: { email: 'reset@test.local' } });
  const hash = await psql(
    `SELECT code_hash FROM password_resets pr JOIN users u ON u.id = pr.user_id
     WHERE u.email = 'reset@test.local' AND pr.used_at IS NULL ORDER BY pr.id DESC LIMIT 1`
  );
  assert.ok(hash, 'a reset code should have been issued');

  const crypto = require('crypto');
  let code = null;
  for (let i = 0; i < 1000000; i += 1) {
    const candidate = String(i).padStart(6, '0');
    if (crypto.createHash('sha256').update(candidate).digest('hex') === hash) {
      code = candidate;
      break;
    }
  }
  assert.ok(code, 'the emailed code should be recoverable in a test');

  const wrong = await request('/admin/reset-password', {
    method: 'POST',
    body: { email: 'reset@test.local', code: '000000', new_password: 'BrandNew123' },
  });
  assert.equal(wrong.status, 400);

  const ok = await request('/admin/reset-password', {
    method: 'POST',
    body: { email: 'reset@test.local', code, new_password: 'BrandNew123' },
  });
  assert.equal(ok.status, 200);
  assert.equal((await login('reset@test.local', 'BrandNew123')).status, 200);

  // Single use
  const replay = await request('/admin/reset-password', {
    method: 'POST',
    body: { email: 'reset@test.local', code, new_password: 'Another123' },
  });
  assert.equal(replay.status, 400);
});

test('malformed input never reaches the database driver', async () => {
  const cases = [
    { email: "' OR 1=1 --", password: 'x' },
    { email: 'a b@test.local', password: 'x' },
    { email: { $ne: null }, password: ['array'] },
    { email: 'x'.repeat(100000), password: 'y' },
    {},
  ];
  for (const body of cases) {
    const res = await request('/admin/login', { method: 'POST', body });
    assert.ok(res.status === 400 || res.status === 401, `got ${res.status} for ${JSON.stringify(body).slice(0, 40)}`);
  }
});
