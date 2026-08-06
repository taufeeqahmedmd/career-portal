// The defences on the one endpoint that writes on behalf of the public:
// honeypot, PDF sniffing, the per-applicant daily cap and the signed form
// token. Booted in the strict posture, so the opt-in guards are on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, request, submitApplication, psql } = require('./helpers');

const crypto = require('crypto');

// The minimum fill time this run enforces
const MIN_SECONDS = 3;

test.before(() =>
  startServer({
    REQUIRE_FORM_TOKEN: 'true',
    MAX_APPLICATIONS_PER_DAY: '3',
    FORM_MIN_SECONDS: String(MIN_SECONDS),
  })
);
test.after(stopServer);

const firstOpening = async () => (await request('/openings')).body.openings[0];

// Mints a token dated far enough in the past to have been filled in by a human.
// Signing it here rather than sleeping keeps the suite fast, and still exercises
// the real signature check - the secret is the one the test server boots with.
const TEST_SECRET = 'test-secret-do-not-use-in-production';
const mintToken = (ageSeconds = 30) => {
  const issuedAt = Date.now() - ageSeconds * 1000;
  const signature = crypto.createHmac('sha256', TEST_SECRET).update(String(issuedAt)).digest('hex');
  return `${issuedAt}.${signature}`;
};
const formToken = async () => mintToken();

// Posts a multipart application with full control over every part of it
async function post(fields, { file, apiKey } = {}) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  if (file !== null) {
    form.append(
      'resume',
      new Blob([file?.bytes ?? Buffer.from('%PDF-1.4 test resume')], {
        type: file?.type || 'application/pdf',
      }),
      file?.name || 'cv.pdf'
    );
  }
  return request('/applications', {
    method: 'POST',
    body: form,
    headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
  });
}

const validFields = async (mobile, extra = {}) => ({
  full_name: 'Valid Applicant',
  email: `${mobile}@example.com`,
  mobile,
  opening_id: String((await firstOpening()).id),
  experience_years: '4',
  current_company: 'Somewhere',
  form_token: await formToken(),
  ...extra,
});

test('the form token endpoint issues a usable token', async () => {
  const res = await request('/form-token');
  assert.equal(res.status, 200);
  assert.match(res.body.token, /^\d+\.[0-9a-f]{64}$/);
  assert.ok(res.body.issued_at);
  assert.equal(res.body.min_seconds, MIN_SECONDS);

  const accepted = await post(await validFields('9600000001'));
  assert.equal(accepted.status, 200);
});

test('a form submitted faster than a human could fill it is refused', async () => {
  // The token the server just issued, used immediately - which is what a script
  // that fetches the form and posts in the same breath produces
  const instant = (await request('/form-token')).body.token;
  const res = await post(await validFields('9600000010', { form_token: instant }));

  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].field, 'form_token');
  assert.match(res.body.errors[0].message, /faster than/i);

  // The same token, once enough time has passed, is fine
  const aged = await post(await validFields('9600000010', { form_token: mintToken(MIN_SECONDS + 2) }));
  assert.equal(aged.status, 200);
});

test('a form left open for too long is refused', async () => {
  // Older than FORM_MAX_SECONDS (2 hours by default)
  const stale = mintToken(3 * 60 * 60);
  const res = await post(await validFields('9600000011', { form_token: stale }));

  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].field, 'form_token');
  assert.match(res.body.errors[0].message, /open too long/i);
});

test('a submission with no form token is refused when one is required', async () => {
  const fields = await validFields('9600000002');
  delete fields.form_token;

  const res = await post(fields);
  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].field, 'form_token');
});

test('a forged or tampered form token is refused', async () => {
  const real = await formToken();
  const [issuedAt, signature] = real.split('.');

  const forged = [
    'not-a-token',
    `${issuedAt}.${'0'.repeat(64)}`,           // wrong signature
    `${Date.now() + 60000}.${signature}`,      // future timestamp, real signature
    `${Number(issuedAt) - 1}.${signature}`,    // shifted timestamp
  ];

  for (const token of forged) {
    const res = await post(await validFields('9600000003', { form_token: token }));
    assert.equal(res.status, 400, `${token} should be refused`);
    assert.equal(res.body.errors[0].field, 'form_token');
  }

  const count = await psql(`SELECT COUNT(*) FROM applications WHERE mobile = '9600000003'`);
  assert.equal(count, '0');
});

test('an API key is accepted instead of a form token', async () => {
  // A server-to-server caller has no browser to fetch a token with; its key is
  // what identifies it
  const crypto = require('crypto');
  const key = `ck_live_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const { runOn } = require('./pgutil');
  const { DB_NAME } = require('./helpers');
  await runOn(
    DB_NAME,
    `INSERT INTO api_keys (name, entity_code, key_prefix, key_hash, rate_limit_per_hour)
     VALUES ($1, NULL, $2, $3, 500)`,
    ['Keyed site', key.slice(0, 16), hash]
  );

  const fields = await validFields('9600000004');
  delete fields.form_token;

  const res = await post(fields, { apiKey: key });
  assert.equal(res.status, 200);
});

test('the honeypot catches a form filler', async () => {
  const res = await post(
    await validFields('9600000005', { company_website: 'http://spam.example' })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].field, 'company_website');

  const count = await psql(`SELECT COUNT(*) FROM applications WHERE mobile = '9600000005'`);
  assert.equal(count, '0');

  // An empty honeypot is what a real browser sends, and is fine
  const ok = await post(await validFields('9600000006', { company_website: '' }));
  assert.equal(ok.status, 200);
});

test('a file is only a PDF if its bytes say so', async () => {
  // A ZIP wearing a PDF content type - what an uploader can trivially claim
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
  const res = await post(await validFields('9600000007'), {
    file: { bytes: zip, type: 'application/pdf', name: 'cv.pdf' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].field, 'resume');
  assert.equal(res.body.errors[0].code, 'unsupported_type');

  // An HTML page renamed to .pdf is refused too
  const html = Buffer.from('<html><body>not a cv</body></html>');
  const asHtml = await post(await validFields('9600000008'), {
    file: { bytes: html, type: 'application/pdf', name: 'cv.pdf' },
  });
  assert.equal(asHtml.status, 400);

  // A real PDF passes
  const real = await post(await validFields('9600000009'), {
    file: { bytes: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'), type: 'application/pdf' },
  });
  assert.equal(real.status, 200);
});

test('one applicant cannot walk the whole vacancy list', async () => {
  const openings = (await request('/openings')).body.openings;
  assert.ok(openings.length >= 4, 'this test needs several vacancies');

  const mobile = '9600001100';
  const results = [];
  for (const opening of openings.slice(0, 4)) {
    results.push(
      await post(
        await validFields(mobile, {
          opening_id: String(opening.id),
          email: 'serial@example.com',
        })
      )
    );
  }

  // The cap is 3 for this run
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.equal(results[3].status, 429);
  assert.equal(results[3].body.errors[0].code, 'rate_limited');

  // The same person under a different number but the same email is still capped
  const byEmail = await post(
    await validFields('9600001199', {
      opening_id: String(openings[0].id),
      email: 'serial@example.com',
    })
  );
  assert.equal(byEmail.status, 429, 'the cap follows the email as well as the mobile');
});

test('a sandbox run is subject to the same defences', async () => {
  const res = await post(
    await validFields('9600002001', { sandbox: 'true', company_website: 'bot' })
  );
  assert.equal(res.status, 400, 'the honeypot applies to dry runs too');
  assert.equal(res.body.errors[0].field, 'company_website');
});
