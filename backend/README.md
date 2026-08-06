# Careers Backend

Express API for the Delhi Public Schools & Pallavi Group of Schools careers referral portal. Stores applications, job openings, and admin users in SQLite (`better-sqlite3`).

## Setup

```bash
npm install
cp .env.example .env   # set JWT_SECRET, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
npm start
```

On first start the server creates the database (default `data/careers.db`), applies `db/schema.sql`, seeds the initial super admin from env, and seeds default job openings if none exist. `npm run seed` runs the same seeding standalone.

See the root `README.md` for the full API endpoint list and environment variable reference.

## Protecting the application endpoint

`POST /api/applications` is the only route that writes on behalf of the public.
Six defences sit on it. Four are always on and need no configuration:

| Defence | What it stops |
|---|---|
| Honeypot (`company_website`) | Anything that fills in every input it finds |
| PDF signature check | Files claiming `application/pdf` that are not one |
| Per-applicant daily cap | One person walking the whole vacancy list (`MAX_APPLICATIONS_PER_DAY`, default 8, 0 disables) |
| Rate limits | Volume, per IP for keyless callers and per key for identified ones |

The other two are switches, because both change who can submit:

```bash
REQUIRE_FORM_TOKEN=true   # keyless submissions must present a token from GET /api/form-token
REQUIRE_API_KEY=true      # every submission needs a key - this locks out the browser form
```

`REQUIRE_FORM_TOKEN` is the one you want for a normal deployment. The token is a
signed timestamp: it proves the form was fetched from this server and that at
least `FORM_MIN_SECONDS` (3) passed before submitting, which a script that
fetches and posts in one breath cannot produce. The portal's own form already
requests and returns it, so switching this on costs nothing once the frontend is
deployed. `REQUIRE_API_KEY` is only for an instance that serves no browser form
of its own.

### Recommended posture

1. **Set `TURNSTILE_SECRET_KEY`** (and `REACT_APP_TURNSTILE_SITE_KEY` in the
   frontend). This is the strongest single layer and the fastest to add.
2. **Set `REQUIRE_FORM_TOKEN=true`** after deploying a frontend that requests the
   token — belt and braces, and it keeps working if Cloudflare is unreachable.
3. **Set `TRUST_PROXY`** if anything sits in front of this process. Without it
   every visitor shares one rate-limit bucket, so one flood stops all genuine
   applicants.
4. **Set `ALLOWED_ORIGINS`** to the sites that may call the API from a browser.

With none of 1 or 2 in place the server reports the write path as unprotected at
boot, under `[needs attention]`. That warning is not decoration: rate limiting
alone slows a flood down, it does not stop one.

## Reports

`GET /api/admin/reports?days=30` returns one read-only snapshot - accounts,
entities and branches, vacancies with what each has attracted, intake by stage
and source, and what the team has done in the period. `GET /api/admin/reports/export`
is the same thing as a CSV.

It needs the **`reports.view`** permission, which is not implied by any other:
the page is a broad view, so a role gets it deliberately. Everything in it is
scoped like the rest of the panel - an entity or branch admin sees their own
slice. The user roster additionally requires `users.manage`; without it the
report reports the headcount and withholds the list.

## API keys for the group's other websites

Other sites in the group post applications straight to the public API. Each one
gets its own key, locked to its business, with its own hourly allowance.

```bash
npm run api-key -- create --name "Acme Logistics careers site" --entity Acme --limit 120
npm run api-key -- list
npm run api-key -- revoke --id 3
```

The plaintext key is printed **once**, at creation - only its SHA-256 digest is
stored, so a database dump cannot be replayed as a credential. If a key is lost
or leaked, revoke it and issue another; nothing else is affected.

`--entity` is the entity `code` exactly as it appears on the Entities page. A key
carrying one may only file applications against that business's openings, whatever
`opening_id` it sends. Omitting it produces an unrestricted key - only appropriate
for something you operate yourself.

What a key changes for the caller:

| | No key (the careers portal's own form) | With a key |
|---|---|---|
| Captcha | Required when Turnstile is configured | Skipped - a server cannot solve one |
| Rate limit | `RATE_LIMIT_APPLY` per IP per hour | The key's own `rate_limit_per_hour` |
| Entity | Any active opening | Only the key's entity |
| Recorded on the application | `submitted_via` empty | `submitted_via` = the key's name |

An **invalid** key is always rejected with `401` rather than being downgraded to
the anonymous path, so a misconfigured site fails loudly instead of quietly
submitting without its identity.

Hand partners [`docs/CAREERS-API.md`](../docs/CAREERS-API.md) - the integration
guide, with the field rules, the error contract, the sandbox mode and worked
Node/PHP examples. Do not send them this file.

### Before a partner goes live

- Issue the key and send it over a channel you would send a password over.
- If the partner posts from a **browser** rather than their server, add their
  domain to `ALLOWED_ORIGINS` and register it with Cloudflare Turnstile - a
  browser-side integration cannot hold a key safely and must pass the captcha
  instead.
- Set `TRUST_PROXY` if the API runs behind nginx or Cloudflare. Without it every
  anonymous submission shares one rate-limit bucket.
