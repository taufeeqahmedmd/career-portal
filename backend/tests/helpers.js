// Test harness: boots the real server against a throwaway database and drives
// it over HTTP, so the tests exercise routing, middleware, permissions and SQL
// exactly as production does. No mocks.
//
// Uses node:test and node:assert - no extra dependencies.
const { spawn } = require('child_process');
const { urlFor, scalar, recreateDatabase, dropDatabase } = require('./pgutil');

// Each test file gets its own database and port, derived from its filename, so
// the suite can be run file by file or all at once without collisions.
const entry = require('path').basename(process.argv[1] || 'tests', '.js').replace(/\W/g, '_');
const suffix = [...entry].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 500, 7);

const DB_NAME = process.env.TEST_DB || `careers_test_${entry}`;
const PORT = Number(process.env.TEST_PORT || 5200 + suffix);
const BASE = `http://localhost:${PORT}/api`;

const ADMIN_EMAIL = 'root@test.local';
const ADMIN_PASSWORD = 'RootPass123!';
const INITIAL_PASSWORD = '12345678';

let serverProcess = null;

// Reads a single value out of the test database
const psql = (sql, database = DB_NAME) => scalar(database, sql);

// Fails if the port is already taken. Without this a leftover server from an
// interrupted run answers /health, the one we just spawned dies on EADDRINUSE,
// and the whole file runs against the wrong process - against a database that
// was just recreated underneath it, so every request 401s for no visible reason.
async function requirePortFree() {
  try {
    const res = await fetch(`${BASE}/health`);
    if (res.ok) {
      throw new Error(
        `Port ${PORT} is already serving. A test server from an earlier run is ` +
          `still alive - kill it before running the suite.`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already serving')) throw err;
    // Anything else means nothing is listening, which is what we want
  }
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // A server that exited (bad env, failed migration) will never answer, and
    // waiting the full timeout just hides the reason
    if (!serverProcess || serverProcess.exitCode !== null) {
      throw new Error('Test server exited during startup.');
    }
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Test server did not start in time.');
}

async function startServer() {
  await requirePortFree();
  await recreateDatabase(DB_NAME);

  serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: require('path').join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: urlFor(DB_NAME),
      JWT_SECRET: 'test-secret-do-not-use-in-production',
      SEED_ADMIN_EMAIL: ADMIN_EMAIL,
      SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
      APP_TIMEZONE: 'Asia/Kolkata',
      INITIAL_USER_PASSWORD: INITIAL_PASSWORD,
      INITIAL_PASSWORD_DAYS: '7',
      // Tests need branches and openings to work with. Production leaves this
      // unset and starts with an empty careers site.
      SEED_SAMPLE_DATA: 'true',
      // Never reach a real mail server, Drive folder or captcha from a test
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      GOOGLE_DRIVE_FOLDER_ID: '',
      GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '',
      GOOGLE_OAUTH_CLIENT_ID: '',
      GOOGLE_OAUTH_CLIENT_SECRET: '',
      GOOGLE_OAUTH_REFRESH_TOKEN: '',
      TURNSTILE_SECRET_KEY: '',
      // Generous, so a test run is never throttled by its own traffic
      RATE_LIMIT_LOGIN: '100000',
      RATE_LIMIT_APPLY: '100000',
      RATE_LIMIT_PUBLIC: '100000',
      RATE_LIMIT_PASSWORD_RESET: '100000',
      RATE_LIMIT_PASSWORD_REDEEM: '100000',
      RATE_LIMIT_TOTP: '100000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  serverProcess.stdout.on('data', (d) => logs.push(d.toString()));
  serverProcess.stderr.on('data', (d) => logs.push(d.toString()));
  serverProcess.on('exit', (code) => {
    if (code) console.error('Test server exited:', code, '\n', logs.join(''));
  });

  await waitForServer();
}

async function stopServer() {
  const child = serverProcess;
  serverProcess = null;
  if (child && child.exitCode === null) {
    // Wait for the process to actually go, not a fixed guess - its pool holds
    // connections that would otherwise block DROP DATABASE
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  await dropDatabase(DB_NAME);
}

// ---- Request helpers -------------------------------------------------------

async function request(path, { method = 'GET', token, body, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Not every response is JSON (CSV downloads, streams)
  }
  return { status: res.status, body: data, headers: res.headers };
}

const login = (email, password) =>
  request('/admin/login', { method: 'POST', body: { email, password } });

const rootToken = async () => (await login(ADMIN_EMAIL, ADMIN_PASSWORD)).body.token;

// Creates a user and completes the forced first password change, returning a
// usable session token
async function createUserAndSignIn(token, { name, email, roleId, ...scope }) {
  const created = await request('/admin/users', {
    method: 'POST',
    token,
    body: { name, email, role_id: roleId, ...scope },
  });
  if (created.status !== 201) {
    throw new Error(`Could not create ${email}: ${created.body?.error}`);
  }
  const first = await login(email, INITIAL_PASSWORD);
  const changed = await request('/admin/change-password', {
    method: 'POST',
    token: first.body.token,
    body: { current_password: INITIAL_PASSWORD, new_password: 'TestPass12345' },
  });
  return { id: created.body.user.id, token: changed.body.token, password: 'TestPass12345' };
}

async function createRole(token, name, permissions) {
  const res = await request('/admin/roles', {
    method: 'POST',
    token,
    body: { name, description: `test role ${name}`, permissions },
  });
  if (res.status !== 201) throw new Error(`Could not create role ${name}: ${res.body?.error}`);
  return res.body.role.id;
}

// Submits a public application with a small in-memory PDF
async function submitApplication({ name, mobile, openingId, ...extra }) {
  const form = new FormData();
  form.append('full_name', name);
  form.append('email', `${mobile}@example.com`);
  form.append('mobile', mobile);
  form.append('opening_id', String(openingId));
  form.append('experience_years', extra.experience || '3');
  form.append('current_company', extra.company || 'Test School');
  Object.entries(extra.fields || {}).forEach(([k, v]) => form.append(k, v));
  form.append(
    'resume',
    new Blob([Buffer.from('%PDF-1.4 test resume')], { type: 'application/pdf' }),
    'cv.pdf'
  );
  return request('/applications', { method: 'POST', body: form });
}

module.exports = {
  BASE,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  INITIAL_PASSWORD,
  startServer,
  stopServer,
  request,
  login,
  rootToken,
  createUserAndSignIn,
  createRole,
  submitApplication,
  psql,
  DB_NAME,
};
