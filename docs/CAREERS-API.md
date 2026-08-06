# Careers API — integration guide

This is the interface another website in the group uses to publish its vacancies
and receive job applications into the shared careers portal. Applications filed
through it appear in the same admin panel, under the same hiring pipeline, as
those from the portal's own careers site.

You need two things before you start: the **base URL** of the portal's API and an
**API key**, both issued by the portal team.

---

## 1. The shape of an integration

Three steps, and only the third one needs your key:

1. `GET /api/openings?entity=YOUR_CODE` — the vacancies to show on your site
2. Render your own form, however it should look
3. `POST /api/applications` — send the completed form with the CV attached

Your form must send the `id` of an opening from step 1. Vacancies live in the
portal, not on your site, so the hiring team can open and close roles without
asking you to deploy anything.

---

## 2. Authentication and anti-spam

The endpoint that files applications writes to a real hiring pipeline on behalf
of the public, so it is defended in layers. Most of them cost you nothing; two
need a line of code each.

| Layer | Applies to | What you do |
|---|---|---|
| API key | server-to-server | Send `X-API-Key`. Identifies you, sets your rate limit, locks you to your business. |
| Captcha | browser forms with no key | Render a Turnstile widget, send `captcha_token`. Not needed if you use a key. |
| Form token | browser forms with no key | Fetch `GET /api/form-token` when the form loads, return it as `form_token`. |
| Honeypot | **everyone** | Include a hidden `company_website` field and leave it empty. |
| PDF signature | everyone | Send a real PDF. The bytes are checked, not the content type you declare. |
| Per-applicant cap | everyone | Nothing — one person may apply for up to 8 positions a day across the whole group. |
| Rate limit | everyone | Stay inside your allowance. |

**If you post from your own server with an API key**, you need the honeypot and
a genuine PDF. The captcha and form token do not apply to you — a server has no
browser to solve one in, and your key is what identifies you instead.

**If you post straight from the browser without a key**, you need the captcha
and the form token as well. Ask the portal team to enable your domain first.

### The honeypot

Include this field in your form, hidden, and never fill it in:

```html
<div style="position:absolute;left:-9999px" aria-hidden="true">
  <label for="company_website">Company website</label>
  <input type="text" id="company_website" name="company_website" tabindex="-1" autocomplete="off">
</div>
```

A real applicant cannot see it, cannot tab to it, and a screen reader skips it.
A bot filling in every input it finds completes it, and the submission is
rejected with `field: "company_website"`.

If you forward a form from your own server, pass the field through — or send it
empty. **Do not omit it silently and do not let your own code populate it.**

### The form token

```js
// when the form loads
const { token } = await (await fetch(`${CAREERS}/api/form-token`)).json();

// when it submits
body.append('form_token', token);
```

It is a signed timestamp. It proves the form came from us, and that at least a
few seconds passed before submitting — a script that fetches and posts in the
same breath is rejected with *"faster than a form can be filled in"*. Tokens are
good for two hours; past that the applicant is asked to reload.

## 3. Your API key

Send your key on every `POST /api/applications`:

```
X-API-Key: ck_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`Authorization: Bearer ck_live_…` is accepted too, if that suits your framework
better.

Your key does three things:

- **Locks you to your own business.** A key issued to one company can only file
  applications against that company's vacancies. An `opening_id` belonging to
  anyone else is rejected, so a mistake cannot leak candidates into another
  company's pipeline.
- **Gives you your own rate limit**, separate from every other site's.
- **Exempts you from the captcha**, which a server cannot solve.

Treat the key like a password. Keep it in an environment variable on your
server — **never in JavaScript the browser can read**, and never in a public
repository. If it leaks, ask for it to be revoked and reissued; that takes
seconds and only affects your site.

The listing endpoints (`/api/openings`, `/api/entities`, `/api/branches`) are
public and need no key.

### Where to put the POST

**Recommended:** your page submits to your own server, and your server calls this
API with the key. The key stays private, and your rate limit is counted per key
rather than per visitor.

Posting straight from the browser also works, but then the key would be visible
in the page — so a browser-side integration must leave the key out and satisfy
the captcha instead. Ask the portal team if you need that; your domain has to be
registered with Cloudflare Turnstile and added to `ALLOWED_ORIGINS` first.

---

## 4. Endpoints

Base path: `{BASE_URL}/api`

### `GET /openings`

The vacancies currently published. Only openings whose branch and business are
both active are returned, so anything you get back can be applied to.

Every parameter is optional and they combine freely — build whatever listing
your page needs.

| Query | Meaning |
|---|---|
| `entity` | One business, by code. Case-insensitive. **Always send this.** |
| `branch` | One branch or location. Case-insensitive. |
| `position` | One exact job title. |
| `category` | `Academic` or `Non-Academic`. |
| `curriculum` | e.g. `CBSE`, `CIE`. |
| `q` | Free text across position, branch and eligibility. |
| `sort` | `default`, `newest`, `oldest`, `position`, `branch`. |
| `limit` | 1–100. Omit to receive every match. |
| `offset` | Skip this many. Use with `limit` to page. |

```bash
curl "{BASE_URL}/api/openings?entity=Acme&category=Non-Academic&sort=newest&limit=10"
```

```json
{
  "openings": [
    {
      "id": 8,
      "position": "PRT - All Subjects",
      "branch": "Pallavi Aware International School, Saroornaagar",
      "school_group": "Pallavi",
      "eligibility": "Postgraduates / Graduates with B.Ed. having minimum 1 year experience.",
      "category": "Academic",
      "curriculum": null,
      "posted_at": "2026-07-29T07:21:44.000Z",
      "updated_at": "2026-07-29T07:21:44.000Z"
    }
  ],
  "total": 34,
  "count": 10,
  "limit": 10,
  "offset": 0
}
```

`total` is the whole match; `count` is what this page contains. Without `limit`
you get everything and `total` equals `count`.

A filter that matches nothing returns `{"openings": []}` — not an error. A
parameter with an impossible *value* (`category=Nonsense`, `limit=500`) is a
`400` naming the field, in the same error shape as everything else.

Cache the result for a few minutes if your site is busy. Do not hardcode ids:
they change as the hiring team opens and closes roles.

### `GET /openings/:id`

One vacancy, for a job-detail page. A closed or unknown one is a `404`, so your
page never shows an apply button the API would reject.

```json
{ "opening": { "id": 8, "position": "PRT - All Subjects", "...": "..." } }
```

### `GET /openings/filters`

The values actually present in the live vacancy list — for building dropdowns
without hardcoding names that change. Takes the same filters, so asking for one
entity returns that entity's branches and positions only.

```bash
curl "{BASE_URL}/api/openings/filters?entity=Acme"
```

```json
{
  "entities": ["Acme"],
  "branches": ["Acme Hyderabad", "Acme Pune"],
  "positions": ["Driver", "Fleet Supervisor"],
  "categories": ["Non-Academic"],
  "curricula": [],
  "total": 6
}
```

### `GET /entities`

Active businesses — `code`, `name`, `color`. Useful once, to confirm your code.

### `GET /branches`

Active branches, each with the entity it belongs to.

### `POST /applications`

Files an application. **`multipart/form-data`** — the CV is a real file upload,
so JSON will not do.

| Field | Required | Rules |
|---|---|---|
| `full_name` | yes | 3–120 characters |
| `email` | yes | valid address, max 254 characters |
| `mobile` | yes | exactly 10 digits, no spaces, no `+91` |
| `opening_id` | yes | an `id` from `GET /openings` |
| `experience_years` | yes | number, 0–60 (decimals allowed, e.g. `2.5`) |
| `current_company` | yes | max 120 characters. Send `"Fresher"` if none |
| `resume` | yes | **PDF only**, max 5 MB, must not be empty |
| `referral_employee_name` | conditional | required if any referral field is sent |
| `referral_employee_contact` | conditional | required if any referral field is sent; 10 digits |
| `referral_employee_code` | no | max 60 characters |
| `referral_employee_branch` | no | max 120 characters |
| `company_website` | **yes, empty** | The honeypot. Always send it, always blank. See §2 |
| `form_token` | conditional | Required for browser submissions with no API key. See §2 |
| `captcha_token` | conditional | Required for browser submissions with no API key, when Turnstile is on |
| `attribution` | no | JSON string, see §7 |
| `sandbox` | no | `true` runs a dry run, see §6 |

The referral block is all-or-nothing: send none of it, or send at least the
referrer's name and mobile.

**Success — `200`**

```json
{ "success": true, "message": "Application submitted." }
```

---

## 5. Errors

Every failure has the same shape. `errors` lists every problem at once, so you
can mark up your whole form in one pass rather than one field per round trip.

```json
{
  "success": false,
  "error": "Mobile number must be exactly 10 digits.",
  "errors": [
    { "field": "mobile", "code": "invalid", "message": "Mobile number must be exactly 10 digits." },
    { "field": "resume", "code": "required", "message": "Resume upload is required." }
  ]
}
```

`error` repeats the first message, for a quick single-line display.

**Branch on `code`, never on `message`.** Messages get reworded; codes do not.

| Code | Meaning |
|---|---|
| `required` | Field missing or empty |
| `invalid` | Wrong format |
| `too_short` / `too_long` | Length outside the allowed range |
| `out_of_range` | Number outside the allowed range |
| `unsupported_type` | The CV is not a PDF — either the type or the bytes |
| `not_found` | The `opening_id` is closed or does not exist |
| `duplicate` | This mobile has already applied for this position |
| `forbidden` | Your key may not post to that opening |
| `unauthorized` | Key missing, wrong, or revoked |
| `rate_limited` | Too many submissions this hour, **or** this applicant has hit the daily cap |
| `upstream_failed` | Our CV storage was unreachable — safe to retry |

Two of these are anti-spam rejections worth handling explicitly:

| Field | Code | What happened | What to do |
|---|---|---|---|
| `company_website` | `invalid` | The honeypot was filled in | Your form or a bot populated it. Never write to this field. |
| `form_token` | `invalid` | Missing, forged, too fast, or expired | Fetch a fresh token and ask the applicant to resubmit. Read the message: *"open too long"* means reload, *"faster than"* means your code posted without a real form. |

### Status codes

| Status | When | What to do |
|---|---|---|
| `200` | Accepted | Show your thank-you page |
| `400` | Validation failed | Show the field errors |
| `401` | Key missing/invalid/revoked | Check configuration; do not retry |
| `403` | That opening is not yours | Check your `entity` filter |
| `409` | Already applied | Tell the candidate — this is not an error to retry |
| `429` | Rate limited | Back off, retry later |
| `502` | CV storage failed | Retry once after a short pause |
| `500` | Our bug | Report it with the time and the applicant's email |

**The duplicate rule:** one application per mobile number per position. The same
person may apply for a different position, and a different person may apply for
the same one. A `409` is a normal outcome worth wording kindly on your site.

---

## 6. Sandbox — testing without creating applicants

Add `sandbox=true` to any submission. It runs every check a real submission
runs — field rules, your key's permissions, whether the opening is open, whether
this mobile already applied — and then **writes nothing at all**.

```json
{
  "success": true,
  "sandbox": true,
  "message": "Validation passed. Nothing was saved because this was a sandbox request.",
  "would_create": {
    "full_name": "Sandbox Tester",
    "position": "PRT - All Subjects",
    "branch": "Pallavi Aware International School, Saroornaagar",
    "entity": "Pallavi",
    "resume": { "filename": "cv.pdf", "bytes": 20 }
  }
}
```

No applicant appears in the admin panel, no CV is stored, and — importantly —
the "one application per position" rule is not consumed, so you can run the same
test as often as you like with the same number.

Build against `sandbox=true`, then remove the flag to go live. It is the last
line you should change.

---

## 7. Tracking where applicants came from

Optional. Send an `attribution` field containing a JSON **string**:

```json
{
  "utm_source": "linkedin",
  "utm_medium": "cpc",
  "utm_campaign": "drivers-q1",
  "landing_page": "https://acme.example.com/careers",
  "referrer": "https://www.linkedin.com/"
}
```

Recognised: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`,
`utm_content`, `gclid`, `fbclid`, `landing_page`, `referrer`. The usual approach
is to capture these from the query string on first visit, keep them in the
session, and send them with the form.

Send nothing and the application is still labelled with your site's name, so the
hiring team always knows which website it came from.

---

## 8. Rate limits

Your key has its own hourly allowance for `POST /applications` (120 by default;
ask if you expect more). The listing endpoints allow 300 requests a minute.

Responses carry the standard headers:

```
RateLimit-Limit: 120
RateLimit-Remaining: 118
RateLimit-Reset: 3480
```

On `429`, wait until `RateLimit-Reset` seconds have passed. Your budget is yours
alone — exhausting it never affects another site.

---

## 9. Worked examples

### Node.js (server-side)

```js
// npm i undici    (or use global fetch on Node 18+)
const fs = require('fs');

async function submitApplication(form, cvPath) {
  const body = new FormData();
  body.append('full_name', form.fullName);
  body.append('email', form.email);
  body.append('mobile', form.mobile);          // 10 digits, no +91
  body.append('opening_id', String(form.openingId));
  body.append('experience_years', String(form.experienceYears));
  body.append('current_company', form.currentCompany || 'Fresher');
  // The honeypot: always present, always empty
  body.append('company_website', '');
  body.append(
    'resume',
    new Blob([fs.readFileSync(cvPath)], { type: 'application/pdf' }),
    'cv.pdf'
  );

  const res = await fetch(`${process.env.CAREERS_API}/api/applications`, {
    method: 'POST',
    headers: { 'X-API-Key': process.env.CAREERS_API_KEY },
    body,
  });

  const data = await res.json();
  if (res.ok) return { ok: true };

  // Map field errors back onto your own form inputs
  return {
    ok: false,
    status: res.status,
    fieldErrors: Object.fromEntries((data.errors || []).map((e) => [e.field, e.message])),
  };
}
```

### PHP / WordPress

Drop this in your theme's `functions.php`. It posts to the API from the server,
so the key never reaches the browser.

```php
<?php
function careers_submit_application( $fields, $cv_tmp_path, $cv_name ) {
    $boundary = wp_generate_password( 24, false );
    $body     = '';

    foreach ( $fields as $name => $value ) {
        $body .= "--{$boundary}\r\n";
        $body .= "Content-Disposition: form-data; name=\"{$name}\"\r\n\r\n";
        $body .= $value . "\r\n";
    }

    $body .= "--{$boundary}\r\n";
    $body .= "Content-Disposition: form-data; name=\"resume\"; filename=\"{$cv_name}\"\r\n";
    $body .= "Content-Type: application/pdf\r\n\r\n";
    $body .= file_get_contents( $cv_tmp_path ) . "\r\n";
    $body .= "--{$boundary}--\r\n";

    $response = wp_remote_post(
        CAREERS_API . '/api/applications',
        array(
            'timeout' => 30,
            'headers' => array(
                'X-API-Key'    => CAREERS_API_KEY,   // define() these in wp-config.php
                'Content-Type' => "multipart/form-data; boundary={$boundary}",
            ),
            'body'    => $body,
        )
    );

    if ( is_wp_error( $response ) ) {
        return array( 'ok' => false, 'message' => 'Could not reach the careers system.' );
    }

    $code = wp_remote_retrieve_response_code( $response );
    $data = json_decode( wp_remote_retrieve_body( $response ), true );

    if ( 200 === $code ) {
        return array( 'ok' => true );
    }

    $field_errors = array();
    foreach ( (array) ( $data['errors'] ?? array() ) as $error ) {
        $field_errors[ $error['field'] ] = $error['message'];
    }
    return array( 'ok' => false, 'status' => $code, 'errors' => $field_errors );
}
```

Fetching the vacancies for a page:

```php
<?php
$response = wp_remote_get( CAREERS_API . '/api/openings?entity=' . rawurlencode( CAREERS_ENTITY ) );
$openings = json_decode( wp_remote_retrieve_body( $response ), true )['openings'] ?? array();

foreach ( $openings as $opening ) {
    printf(
        '<option value="%d">%s — %s</option>',
        (int) $opening['id'],
        esc_html( $opening['position'] ),
        esc_html( $opening['branch'] )
    );
}
```

### A complete careers page (browser + your server)

The shape most partner sites end up with. The browser talks only to *your*
server, so the key never leaves it.

```js
// ---- your server ----------------------------------------------------------
const CAREERS = process.env.CAREERS_API;          // https://careers.example.org
const ENTITY  = process.env.CAREERS_ENTITY;       // "Acme"
const KEY     = process.env.CAREERS_API_KEY;      // ck_live_…

// 1. Vacancies for your listing page, filtered however you like
app.get('/api/jobs', async (req, res) => {
  const params = new URLSearchParams({ entity: ENTITY, sort: 'newest' });
  if (req.query.branch) params.set('branch', req.query.branch);
  if (req.query.q) params.set('q', req.query.q);

  const upstream = await fetch(`${CAREERS}/api/openings?${params}`);
  res.json(await upstream.json());
});

// 2. Dropdown values, so your filters never go stale
app.get('/api/job-filters', async (_req, res) => {
  const upstream = await fetch(`${CAREERS}/api/openings/filters?entity=${ENTITY}`);
  res.json(await upstream.json());
});

// 3. One vacancy, for the detail page
app.get('/api/jobs/:id', async (req, res) => {
  const upstream = await fetch(`${CAREERS}/api/openings/${req.params.id}`);
  res.status(upstream.status).json(await upstream.json());
});

// 4. The application, forwarded with your key attached
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  // Reject early if your own honeypot was filled in, and never send it filled
  if (String(req.body.company_website || '').trim()) {
    return res.status(400).json({ error: 'This submission looks automated.' });
  }

  const body = new FormData();
  for (const [k, v] of Object.entries(req.body)) body.append(k, v);
  if (!('company_website' in req.body)) body.append('company_website', '');
  body.append(
    'resume',
    new Blob([req.file.buffer], { type: req.file.mimetype }),
    req.file.originalname
  );

  const upstream = await fetch(`${CAREERS}/api/applications`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY },
    body,
  });
  res.status(upstream.status).json(await upstream.json());   // errors pass straight through
});
```

Your page then renders the jobs however it wants, and posts the form — with the
chosen vacancy's `id` as `opening_id` — to `/api/apply`.

### curl (for testing by hand)

```bash
# List your vacancies
curl "{BASE_URL}/api/openings?entity=Acme"

# Newest five non-academic roles at one branch
curl "{BASE_URL}/api/openings?entity=Acme&branch=Acme%20Pune&category=Non-Academic&sort=newest&limit=5"

# What can be filtered on right now
curl "{BASE_URL}/api/openings/filters?entity=Acme"

# One vacancy
curl "{BASE_URL}/api/openings/8"

# Dry run - validates everything, saves nothing
curl -X POST "{BASE_URL}/api/applications" \
  -H "X-API-Key: $CAREERS_API_KEY" \
  -F "full_name=Sandbox Tester" \
  -F "email=test@example.com" \
  -F "mobile=9876500011" \
  -F "opening_id=8" \
  -F "experience_years=4" \
  -F "current_company=Acme" \
  -F "sandbox=true" \
  -F "resume=@cv.pdf;type=application/pdf"

# The real thing: the same call without the sandbox flag
```

---

## 10. Going live — checklist

- [ ] Vacancies created in the admin panel and marked active
- [ ] Your site reads `GET /openings?entity=YOUR_CODE`; no ids hardcoded
- [ ] Key stored in an environment variable, on the server, never in the browser
- [ ] **Hidden `company_website` field present in your form and sent empty**
- [ ] **A real PDF is sent** — reject other file types before submitting
- [ ] Browser-side integrations only: `form_token` fetched on load and returned
- [ ] Every field validated on your side too, so applicants see problems before submitting
- [ ] All error `code`s handled, `409` and `429` worded for a human
- [ ] Tested end to end with `sandbox=true` — the anti-spam rules apply to dry runs too
- [ ] One real submission made and confirmed visible in the admin panel
- [ ] `sandbox` flag removed

---

## 11. Field changes

New fields will be added as businesses need them. Two rules protect your
integration:

1. **A new field is optional unless we have agreed otherwise with you.** An
   existing form keeps working when a field appears.
2. **Nothing is renamed or removed** without telling you first. Field names are
   permanent.

If your form starts getting a `400` you do not recognise, read the `errors`
array — it names the field and why it was rejected.

---

## Support

Report problems to the portal team with:

- the time (with timezone), the applicant's email, and the `opening_id`
- the full JSON response you received, including the `errors` array
- the HTTP status code

Never include your API key in a bug report, a ticket, or a screenshot.
