# Career Portal: How It Works

_Last reviewed against the code on 2026-09-22 (branch `dev`)._

This document explains what the careers portal is, how it is built, how data moves through it, and how it is run in production. It is written for an engineer who is new to the codebase. The root `README.md` still describes the original SQLite version of the project; where the two disagree, this document reflects the code as it is today.

**Contents**

1. [What the project is](#1-what-the-project-is)
2. [Tech stack](#2-tech-stack)
3. [Repository layout](#3-repository-layout)
4. [Architecture and request lifecycle](#4-architecture-and-request-lifecycle)
5. [Data model](#5-data-model)
6. [Authentication, sessions, roles and scope](#6-authentication-sessions-roles-and-scope)
7. [Key flows](#7-key-flows)
8. [API surface](#8-api-surface)
9. [Setup and local development](#9-setup-and-local-development)
10. [Deployment and CI/CD](#10-deployment-and-cicd)
11. [Integrations](#11-integrations)
12. [Operations: caching, backups, scripts, startup checks](#12-operations-caching-backups-scripts-startup-checks)
13. [Known gaps and suggested next steps](#13-known-gaps-and-suggested-next-steps)

---

## 1. What the project is

A careers portal for two Hyderabad school groups, **Delhi Public Schools (DPS)** and **Pallavi Group of Schools**, with a public job site and an HR admin panel in one deployment. It runs at `dpgos-careers.k-innovative.com`. The code lives on GitHub under `taufeeqahmedmd/career-portal`; `dev` is the working branch and `main` is what deploys.

Three kinds of people use it:

- **Candidates** browse active vacancies, filter by school group and branch, and submit a short application: name, mobile, email, years of experience, current employer, a PDF resume, and an optional referring employee (name, mobile, employee ID, department). Teachers share the page with candidates, which is why the referral fields exist.
- **HR and hiring staff** sign in at `/admin` and work the hiring pipeline: screening notes, salary expectations, a stage per candidate (New, In Process, Shortlisted, In Interview, Selected, Hold, Not Selected), up to two interview rounds with an assignee and feedback, an optional hand-off to another branch, and a suggested alternative role. They also manage openings, branches, school groups (entities), users, roles, dropdown values and reports, and export CSVs.
- **Partner websites** in the group post applications straight into the portal through the public API with an API key, so one applicant database serves every school site. The integration guide for them is `docs/CAREERS-API.md`.

The project started as a small SQLite referral form. It has since grown into a PostgreSQL system with dynamic roles, two-factor sign-in, a multi-stage pipeline, partner API keys, a cache layer, connection pooling and instance-wide reports.

## 2. Tech stack

Plain JavaScript on both sides. No TypeScript, no ORM, no framework beyond Express and Create React App.

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | React 18 via Create React App (`react-scripts` 5) | Single-page app; `npm run build` produces a static bundle served by nginx |
| Routing | React Router 7 | Public site at `/` and `/:entitySlug`; admin panel under `/admin/*` |
| Styling | Tailwind CSS (PostCSS) plus hand-written CSS in `src/styles` | Swiper for carousels, AOS for scroll animation, `react-icons` |
| HTTP client | Axios | One shared client in `src/services/api.js` with a bearer-token interceptor |
| Frontend extras | jsPDF, docx-preview, react-toastify, react-modal, react-countup | Applicant profile PDF, legacy Word resume preview, toasts |
| Backend | Node.js 22, Express 4 | Entry point `backend/index.js`; controllers are async and route errors to one handler |
| Database | PostgreSQL 16 via the `pg` driver | Raw SQL with `?` placeholders rewritten to `$n`; schema applied idempotently on every boot |
| Pooling | PgBouncer (transaction mode) in production | Bypassable with one env var (`DB_HOST=postgres`) |
| Cache | Redis 7 via `ioredis`, or an in-process Map fallback | Dashboard counters, flow-option dropdowns, entity/branch lists |
| Auth | `bcryptjs`, `jsonwebtoken`, hand-rolled TOTP (RFC 6238) with `qrcode` for enrolment | Stateless JWT sessions, optional two-factor |
| Abuse controls | `express-rate-limit`, Cloudflare Turnstile, honeypot field, signed form tokens, PDF byte sniffing, per-applicant daily cap | Per-IP or per-API-key limits |
| Files | `multer` (memory storage), Google Drive via `googleapis`, local-disk fallback | PDF resumes up to 5 MB |
| Email | `nodemailer` over SMTP | Welcome, password reset and export-approval mails with inline logos |
| Tests | Node's built-in `node:test` runner, nine suites, each booting the real server against its own scratch PostgreSQL database | `npm test` in `backend/` |
| Containers | Docker Compose: postgres, pgbouncer, redis, backend (frontend container only in the dev compose file) | Backend image runs as a non-root user on `node:22-bookworm-slim` |
| Hosting | Ubuntu EC2, host nginx with Let's Encrypt, GitHub Actions self-hosted runner | Documented step by step in `DEPLOY.md` |
| Analytics | Google Tag Manager (`GTM-5JN7RCPM`) in `public/index.html`; UTM and click-id capture on the form | Attribution stored per application |

## 3. Repository layout

```
career-portal/
├── backend/                     Express API
│   ├── index.js                 Boot: env check, CORS, headers, routes, error handler, schema + seed, startup checks
│   ├── db/
│   │   ├── index.js             pg Pool, `?` -> `$n` rewriting, get/all/run helpers
│   │   ├── schema.sql           All tables (CREATE ... IF NOT EXISTS)
│   │   ├── init.js              Applies schema, UTC default, additive column migrations, indexes, unique index
│   │   ├── seed.js              Entities, system roles, first super admin, flow options, one-time data migrations
│   │   └── QUERIES.md           Hand-run SQL reference (written for SQLite; see §13)
│   ├── routes/
│   │   ├── public.js            /api/*  (openings, branches, entities, form token, applications)
│   │   ├── data.js              /api/data/*  (read-only reporting feed, reporting key)
│   │   └── admin.js             /api/admin/*  (auth, then every admin resource)
│   ├── controllers/             One file per resource: auth, applications, openings, branches, entities, users, roles, flow, reports
│   ├── middlewares/
│   │   ├── auth.js              requireAuth, requirePermission, requirePasswordChanged
│   │   ├── apiKey.js            attachApiKey for partner sites
│   │   └── rateLimit.js         Login, apply, public, password-reset, TOTP limiters
│   ├── utils/                   antiSpam, apiKeys, attribution, cache, csv, csvImport, drive, errors, mailer,
│   │                            permissions, scope, session, settings, startupChecks, totp, turnstile, validate
│   ├── scripts/                 api-key.js, backup-db.sh, RESTORE.md, get-google-refresh-token.js,
│   │                            revoke-public-resumes.js, migrate-sqlite-to-pg.js, import-legacy-applications.sql
│   ├── tests/                   node:test suites + helpers (spawn the server, drive it over HTTP)
│   ├── assets/email/            Logos embedded in outgoing mail
│   └── .env.example             Every backend setting, documented
├── frontend/                    React app (Create React App)
│   ├── public/index.html        GTM snippet, meta tags, fonts
│   ├── src/
│   │   ├── index.js, App.js     Router and route table
│   │   ├── pages/Home.js        Public careers page (all entities or one entity's landing page)
│   │   ├── components/          Public site sections: Navbar, Hero, About, JobList, HeroApplicationForm, Turnstile, ...
│   │   ├── admin/               Admin shell: AdminLayout, AuthContext, ProtectedRoute, ResumePreview, ImportCsvModal, profilePdf, ui
│   │   ├── admin/pages/         Dashboard, Applications, ApplicantProfile, Openings, Branches, Entities, Users, Roles, FlowConfig, Reports, Login, ChangePassword
│   │   ├── services/api.js      Every API call the frontend makes
│   │   ├── attribution.js       First-touch UTM / click-id capture (sessionStorage)
│   │   ├── entities.js          Slug -> entity branding (/dps, /pgos)
│   │   └── assets/              Images, logos, branch photos
│   ├── nginx.conf               Used only by the frontend Docker image (dev compose)
│   ├── .env.example             REACT_APP_TURNSTILE_SITE_KEY, REACT_APP_TIMEZONE, REACT_APP_API_URL
│   └── .env.production          GENERATE_SOURCEMAP=false
├── docs/
│   ├── CAREERS-API.md           Integration guide handed to partner sites
│   ├── DATA-API.md              Read-only data feed for reporting tools
│   └── PROJECT-OVERVIEW.md      This document
├── .github/workflows/deploy.yml CI on PRs to main; deploy on push to main
├── docker-compose.yml           Dev stack: postgres + backend + frontend(nginx)
├── docker-compose.prod.yml      Prod stack: postgres + pgbouncer + redis + backend (host nginx serves the build)
├── Dockerfile.backend, Dockerfile.frontend
├── DEPLOY.md                    EC2 runbook
└── README.md                    Original overview (partly outdated)
```

## 4. Architecture and request lifecycle

```mermaid
flowchart LR
  Browser["Candidate / Admin browser"] -->|HTTPS| Nginx["Host nginx<br/>serves frontend/build<br/>proxies /api/"]
  Partner["Partner site server<br/>X-API-Key"] -->|HTTPS /api| Nginx
  Nginx -->|127.0.0.1:5001| API["Express API<br/>(backend container)"]
  API --> PgB["PgBouncer<br/>transaction mode"]
  PgB --> PG[("PostgreSQL 16")]
  API --> Redis[("Redis cache")]
  API -->|resumes| Drive["Google Drive"]
  API -->|mail| SMTP["SMTP"]
  API -->|captcha verify| CF["Cloudflare Turnstile"]
```

Read it left to right: nginx is the only public entry point, the API binds to loopback, and everything the API depends on is either a container on the same host or an external service reached over HTTPS.

**Frontend.** The React app is a static bundle. In production, host nginx serves `frontend/build` and proxies `/api/` to the backend. In `npm start` development, CRA's dev server proxies `/api` to `localhost:5001` (the `proxy` field in `frontend/package.json`). The app calls `/api` on its own origin unless `REACT_APP_API_URL` overrides it.

**Backend boot** (`backend/index.js`):

1. Loads `.env` and refuses to start without `JWT_SECRET`.
2. Configures `trust proxy` from `TRUST_PROXY`, CORS from `ALLOWED_ORIGINS`, baseline security headers, JSON/urlencoded parsing capped at 256 KB.
3. Mounts `/api` (public) and `/api/admin` (admin), then a last-resort error handler that maps malformed JSON to 400 and PostgreSQL unique/foreign-key violations to 409.
4. `initSchema()` applies `schema.sql`, sets the database timezone to UTC, runs additive column migrations, creates the unique index on `applications(opening_id, mobile)` if no duplicates exist, and creates the filter and trigram indexes.
5. `seed()` fills empty reference tables and runs one-time data migrations tracked in `app_settings` under `migration:*`.
6. `runStartupChecks()` prints a configuration review (missing SMTP, no captcha, no `TRUST_PROXY`, no reachable super admin) without ever refusing to boot.
7. Listens on `PORT` (default 5001).

**A request through the admin API** goes: rate limiter (unauthenticated routes only) → `requireAuth` (verify JWT, load user with role and branch, reject inactive users, deactivated roles and tokens minted before the last password change) → `requirePasswordChanged` (blocks everything except `/me` and `/change-password` while the account is on its initial password) → `requirePermission('x.y')` → controller. Controllers narrow every query by the caller's scope (see §6) and invalidate the cache after writes.

**A request through the public application endpoint** goes: `multer` (parse multipart, 5 MB limit) → `attachApiKey` (identify a partner site) → `applyLimiter` (per key or per IP) → `requireCaptcha` (skipped for keyed callers) → `applications.create` (honeypot, form token, field validation, opening/entity/branch active check, key-to-entity lock, duplicate check, daily cap, sandbox short-circuit, store resume, insert, activity log, cache invalidation).

## 5. Data model

All tables are in `backend/db/schema.sql`. Booleans are `INTEGER` 0/1 (inherited from SQLite). Timestamps are `TIMESTAMPTZ`, stored in UTC; day boundaries for "today" and date filters are computed in `APP_TIMEZONE` (default `Asia/Kolkata` in the env template).

| Table | Purpose | Key columns and rules |
| --- | --- | --- |
| `entities` | School groups (DPS, Pallavi, ...) | `code` is the join key used everywhere else and never changes; `name`, `color`, `is_active`. Unique on `LOWER(code)` |
| `branches` | Schools within an entity | `name`, `school_group` (entity code), `is_active`. Unique per `(school_group, LOWER(name))`. Renaming cascades to openings and applications inside a transaction |
| `roles` | Named permission sets | `permissions` is a JSON array of keys from `utils/permissions.js`; `'*'` means everything. `is_system` marks Super Admin and Admin; `is_active` roles can be assigned |
| `users` | Admin accounts | `email` (unique, case-insensitive), `password_hash`, legacy `role` (`super_admin`/`admin`, kept for its CHECK), `role_id`, `school_group` (NULL = all), `branch_id` (NULL = whole entity), `is_active`, `must_change_password`, `password_changed_at`, TOTP columns (`totp_enabled`, `totp_secret`, `totp_confirmed_at`, `totp_last_step`, `totp_attempts`), `last_login_at` |
| `openings` | Vacancies | `position`, `branch` (text, matches `branches.name`), `school_group`, `eligibility`, `category` (Academic / Non-Academic), `curriculum` (CBSE / CIE, academic only), `is_active`, `created_by_id` |
| `applications` | Candidate submissions | Applicant fields; `opening_id` plus copied `position`/`branch`/`school_group` so history survives edits; referral fields; `resume_link` and `resume_file_id`; `submitted_via` (API key name or blank); attribution (`source`, five `utm_*`, `gclid`, `fbclid`, `tracking_params` JSON); screening fields (`screening_*`, `screening_status`, `screening_next_round`); hand-off (`referred_entity`, `referred_branch`); `suggested_role`; `last_activity_at`. Unique index on `(opening_id, mobile)` |
| `interview_rounds` | Up to two rounds per application | `round_no`, `assigned_to` (user), `assigned_name`, `feedback`, `status` (a stage key), `next_round`, `updated_by`. Unique `(application_id, round_no)` |
| `application_activity` | Timeline per application | `action` (`submitted`, `screening`, `round`, `suggestion`), `detail`, `actor_id` (NULL for the public form) |
| `flow_options` | Configurable dropdown values | `type` in (`profile_stage`, `assignee`, `suggested_role`), `key`, `label`, `color`, `category`, `is_system`, `is_active`, `sort_order`. `new` and `in_interview` stages are system values |
| `api_keys` | Partner site and reporting-tool credentials | `name`, `kind` (`submit` posts applications; `reporting` reads `/api/data`; neither can do the other), `entity_code` (NULL = any entity), `key_prefix` (shown in UI/logs), `key_hash` (SHA-256; plaintext never stored), `rate_limit_per_hour`, `is_active`, `revoked_at`, `last_used_at` |
| `app_settings` | Global switches and migration markers | `require_totp`; `migration:<name>` rows record one-time seeds that must never re-run |
| `password_resets` | Emailed reset codes | `code_hash` (SHA-256), `attempts`, `used_at`, `expires_at` |
| `export_otps` | Approval codes for CSV exports | `code_hash` (bcrypt), `requested_by`, `sent_to`, `filter_key` (the exact filter set approved), `attempts`, `used_at`, `expires_at` |

Two things to keep in mind when touching the schema:

- **Text joins.** `openings.branch` ↔ `branches.name` and every `school_group` column ↔ `entities.code` are matched by value, not by foreign key. The public openings list only returns rows whose branch and entity are both active. Branch rename is handled; entity codes are immutable by design.
- **Migrations live in code.** `init.js` adds missing columns with `ALTER TABLE ... ADD COLUMN` guarded by `information_schema`; `seed.js` runs data backfills once via `runOnce()`. There is no migration tool and no down-migrations.

Indexes worth knowing: `applications(school_group, created_at DESC)`, `applications(branch)`, `(screening_status)`, `(source)`, `(referred_entity, referred_branch)`, `interview_rounds(application_id)`, and GIN trigram indexes on `full_name`, `email`, `mobile`, `referral_employee_code` for the unanchored `ILIKE` search (created only if the `pg_trgm` extension is available).

## 6. Authentication, sessions, roles and scope

**Sign-in** (`POST /api/admin/login`): email + password (+ Turnstile token when configured). The password check always runs bcrypt, against a dummy hash when the user does not exist, so timing cannot enumerate accounts. Inactive users, deactivated roles and expired temporary passwords are refused. If two-factor is required for the user (their own switch, or the global `require_totp` setting), the response is a challenge instead of a session:

- `challenge: "totp"` with a short-lived challenge token when the user is already enrolled;
- `challenge: "totp_setup"` with a fresh secret, `otpauth://` URI and QR data URL when they are not. The secret is only trusted once a code from it is verified.

`POST /api/admin/login/totp` takes the challenge token plus a 6-digit code (30-second steps, ±1 step drift, replay of the last accepted step blocked, 5 wrong guesses per challenge, then start over).

**Sessions** are JWTs (`stage: "session"`, default 8 hours via `SESSION_HOURS`) stored in `localStorage` under `admin_token` and sent as `Authorization: Bearer`. Every token carries a millisecond `ms` claim; `requireAuth` rejects tokens minted before `users.password_changed_at`, so a password change or admin-initiated reset immediately revokes older sessions. A 401 from any admin call clears the token and redirects to `/admin/login`.

**Passwords.** New accounts (created by hand or CSV) start on the shared `INITIAL_USER_PASSWORD` (default `12345678`) with `must_change_password = 1`; the server blocks every route except `/me` and `/change-password` until it is replaced, and the temporary password expires after `INITIAL_PASSWORD_DAYS` (default 7). Rules: at least 8 characters, a letter and a digit, not in a banned list, not the current password. Forgot-password sends a 6-digit code by email (uniform response whether or not the address exists), valid `PASSWORD_RESET_MINUTES` (default 15), 5 attempts, single use.

**Permissions.** The catalog is in `backend/utils/permissions.js`:

| Key | Grants |
| --- | --- |
| `applications.view` | Read applications, dashboard stats, assignees list |
| `applications.manage` | Write screening, interview rounds, suggested role |
| `applications.export` | Request an export code and download CSV |
| `openings.view` / `openings.manage` | List / create and edit openings |
| `branches.manage`, `entities.manage` | Reference data |
| `users.manage` | Create, activate/deactivate users within scope |
| `roles.manage` | Create/edit roles; edit users' role, scope, name; reset passwords |
| `flow.manage` | Flow Configuration page |
| `data.import` | CSV bulk import (never implied by a manage permission) |
| `security.manage` | Global 2FA switch and per-user 2FA toggle |
| `reports.view` | The Reports page (not implied by any other permission) |
| `*` | Everything; reserved for the system Super Admin role |

Seeded roles: **Super Admin** (`*`, immutable) and **Admin** (`applications.view/manage/export`, `openings.view/manage`, `users.manage`). Privilege ceilings apply everywhere: a role can never be given a permission its author lacks, a user can never be created or edited into a role stronger than the actor, nobody can edit their own role or remove their own role management, and the last active super admin cannot be demoted or deactivated.

**Scope** (`backend/utils/scope.js`) is separate from role. A user with `school_group` set sees one entity; with `branch_id` set, one branch. Unrestricted roles have neither. Scope narrows applications (including leads referred *to* the scope's branch), openings, branches, users, assignees, reports and cache keys. Scoped admins cannot create entities, cannot create branches outside their entity, and cannot place users outside their own scope. The frontend mirrors this with `PermissionRoute` and `can()` from `AuthContext`, but the server is the guard.

## 7. Key flows

### 7.1 A candidate applies

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant D as Drive / local disk
  participant P as PostgreSQL
  B->>A: GET /api/openings, /api/entities, /api/config, /api/form-token
  A-->>B: openings, captcha_enabled, signed form token
  B->>A: POST /api/applications (multipart: fields, resume, form_token, captcha_token, attribution)
  A->>A: honeypot, form token age, field rules, PDF bytes
  A->>P: opening active? entity+branch active? duplicate mobile? daily cap?
  A->>D: store resume (Drive, fallback local)
  A->>P: INSERT application (status new) + activity 'submitted'
  A-->>B: {success:true}
```

Front-end details: `Home.js` captures first-touch attribution into `sessionStorage` on load; `HeroApplicationForm` fetches a form token when it opens, renders the hidden `company_website` honeypot, shows step 2 (referral) only when the applicant opts in, renders Turnstile only when `REACT_APP_TURNSTILE_SITE_KEY` is set, and posts `multipart/form-data`. Entity landing pages `/dps` and `/pgos` filter the openings to one entity; `?branch=` and `?position=` pre-filter the job list.

Server details: every validation failure is returned at once in the `{ success, error, errors:[{field, code, message}] }` shape partners integrate against. `sandbox=true` runs every check and writes nothing. A stored resume is deleted again if the insert fails. A keyed submission is stamped with the key's name in `submitted_via` and, when it carries no campaign tags, that name becomes its `source`.

### 7.2 Working the pipeline (admin)

1. **Dashboard** (`/admin`): totals, today, this week vs last week, in interview, referred; a 7/30/90-day trend; recent applications; stage, group and source breakdowns. All from one cached, scope-keyed `GET /api/admin/applications/stats`.
2. **Applications** (`/admin/applications`): paged list (max 100 per page) with search across name, email, mobile and referral code; filters for school group (multi), position, branch, stage (multi), referred/not referred, source (multi), reached-interview, and a date range evaluated in `APP_TIMEZONE`; sort by submitted or last activity.
3. **Applicant profile** (`/admin/applicant-profile`, id kept in `sessionStorage` rather than the URL): header with contact actions, referral block, resume preview (PDF in an iframe; legacy `.docx` via `docx-preview`; legacy `.doc` offered as download), then three stage cards:
   - **Screening**: experience, current and expected salary, location, willing to relocate, comments, profile stage, "Refer to other branch" (entity + active branch, not the current one), "Next interview round?" with the round-1 assignee. Only fields present in the request are written, so two admins with the profile open do not clobber each other.
   - **Interview feedback**, rounds 1 and 2: assignee (from the caller's scoped user list), feedback, stage, "Next interview round?". Round *n* only opens when screening and every earlier round answered Yes; answering No deletes untouched placeholder rounds and closes the chain. Saving a round on a Shortlisted candidate advances them to In Interview.
   - **Suggested for a different role**: must be a configured, active `suggested_role` option.
   - A **timeline** of every action with actor and time, and a **profile PDF** generated in the browser with jsPDF.
4. **Job openings**: create/edit/close per scope; academic openings may carry a curriculum; CSV import (`position`, `branch`, `entity`, `category`, `curriculum`, `eligibility`) with canonical branch-name resolution and duplicate skipping.
5. **Reports** (`/admin/reports`): one read-only snapshot for a chosen period (1 to 365 days, default 30): users (roster only with `users.manage`), entities and branches, vacancies ranked by applications, pipeline stages, share by entity, source / UTM source / campaign / submitting site, and who on the team did what. The same snapshot downloads as a sectioned CSV.

### 7.3 CSV export with approval code

`GET /api/admin/applications/export` requires a one-time code. `POST .../export/request-otp` (with the same filters) counts the rows, emails a 6-digit code to **every active super admin**, throttles to one request per minute, voids older codes, and stores a bcrypt hash bound to a fingerprint of the exact filter set. The download must present the code and identical filters; 10-minute expiry, 5 attempts, single use. The export streams through a server-side cursor in batches of 500 with backpressure, so there is no row cap and constant memory. Cells starting with `=`, `+`, `-`, `@` are prefixed with `'` to defuse spreadsheet formulas.

### 7.4 Managing users

Creating a user (by hand or CSV) assigns the default Admin role unless the actor holds `roles.manage`, clamps the scope to the actor's own, sets the shared initial password, and sends a welcome email with credentials and a plain-English list of capabilities. The response also returns the initial password so the creator can pass it on if mail is off. Editing (role, scope, name, password reset to the initial password) needs `roles.manage`; changing a sign-in email needs a super admin because that address receives reset and export codes. Deactivation is the supported removal. Per-user 2FA toggles and the global "require 2FA" switch need `security.manage`; turning 2FA off wipes the enrolment so a re-enable starts fresh.

### 7.5 Partner sites

A key is issued with `npm run api-key -- create --name "<site>" --entity <CODE> --limit 120` and shown once. Partners read `GET /api/openings?entity=CODE` (with `/openings/filters` for dropdowns and `/openings/:id` for a detail page) and `POST /api/applications` with `X-API-Key`. The key exempts them from the captcha and form token, gives them their own hourly budget, and locks them to their entity's openings. Wrong or revoked keys are refused rather than downgraded to anonymous. Full contract, error codes and worked Node/PHP examples are in `docs/CAREERS-API.md`.

### 7.6 Reporting tools

`GET /api/data` (every dataset in one JSON document) and `GET /api/data/:dataset` (one flat table, JSON or `?format=csv`) feed Power BI, Excel, Sheets and scripts. Datasets: `applications`, `interview_rounds`, `activity`, `openings`, `branches`, `entities`, `users`, `flow_options`; optional `from`/`to` select applications by submission day. A **reporting** key is required (`npm run api-key -- create --name "Power BI" --kind reporting [--entity CODE]`), and an entity key sees what that entity's admins see. The feed is read-only: only GET is accepted (405 otherwise), reporting keys are refused by `POST /api/applications`, and every read runs in a `READ ONLY` transaction. Rows stream through a cursor with no cap. Guide: `docs/DATA-API.md`.

## 8. API surface

Base path `/api`. Unless noted, responses are JSON and errors are `{ error }` (admin) or `{ success:false, error, errors[] }` (public).

**Public** (`backend/routes/public.js`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ ok: true }` |
| GET | `/config` | `{ captcha_enabled }` |
| GET | `/form-token` | Signed timestamp for browser forms |
| GET | `/entities` | Active entities: code, name, color |
| GET | `/branches` | Active branches of active entities with live openings count |
| GET | `/openings` | Active openings; filters `entity`, `branch`, `position`, `category`, `curriculum`, `q`; `sort`; optional `limit`/`offset` |
| GET | `/openings/filters` | Distinct values present in the filtered list |
| GET | `/openings/:id` | One active opening or 404 |
| POST | `/applications` | Multipart submission; optional `X-API-Key`; `sandbox=true` dry run |
| ANY | `/files/resumes/*` | Always 403 (old public resume links fail closed) |

**Reporting feed** (`backend/routes/data.js`, reporting API key, GET only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/data` | Every dataset in one JSON document, one database snapshot |
| GET | `/data/:dataset` | One dataset; `format=json\|csv`, `from`, `to` |

**Admin, unauthenticated** (`backend/routes/admin.js`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/admin/login` | Session token, or a TOTP challenge |
| POST | `/admin/login/totp` | Second leg of two-factor |
| POST | `/admin/forgot-password` | Emails a code; uniform reply |
| POST | `/admin/reset-password` | Redeems the code |

**Admin, signed in** (permission in brackets)

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/admin/me` | any |
| POST | `/admin/change-password` | any (allowed while on the initial password) |
| GET / PUT | `/admin/security` | `security.manage` |
| PATCH | `/admin/users/:id/totp` | `security.manage` |
| GET | `/admin/entities`, `/admin/branches` | any signed-in user (reference data) |
| POST / PUT / DELETE | `/admin/entities[/:id]` | `entities.manage` |
| POST / PUT / DELETE | `/admin/branches[/:id]` | `branches.manage` |
| GET | `/admin/openings` | `openings.view` |
| POST / PUT | `/admin/openings[/:id]` | `openings.manage` |
| POST | `/admin/openings/import` | `openings.manage` + `data.import` |
| GET | `/admin/applications`, `/stats`, `/assignees`, `/:id`, `/:id/resume` | `applications.view` |
| PUT | `/admin/applications/:id/screening`, `/rounds/:roundNo`, `/suggestion` | `applications.manage` |
| POST | `/admin/applications/export/request-otp` | `applications.export` |
| GET | `/admin/applications/export` | `applications.export` (+ `otp` query) |
| GET / POST / PATCH | `/admin/users[/:id]` | `users.manage` |
| POST | `/admin/users/import` | `users.manage` + `data.import` |
| PUT | `/admin/users/:id` | `roles.manage` |
| GET | `/admin/roles` | `users.manage` |
| GET | `/admin/roles/catalog` | `roles.manage` |
| POST / PUT / DELETE | `/admin/roles[/:id]` | `roles.manage` |
| GET | `/admin/flow-options/active` | `applications.view` |
| GET / POST / PUT / DELETE | `/admin/flow-options[/:id]` | `flow.manage` |
| POST | `/admin/flow-options/import` | `flow.manage` + `data.import` |
| GET | `/admin/reports`, `/admin/reports/export` | `reports.view` |

Rate limits (defaults, all overridable by env): login 10 failures / 15 min; application form 15 / hour per IP or the key's own limit (default 120); public reads 300 / min; password reset requests 5 / 15 min; wrong reset codes 15 / 15 min; wrong TOTP codes 12 / 15 min. Behind a proxy these only work with `TRUST_PROXY` set.

## 9. Setup and local development

**Prerequisites:** Node 22 (backend) / Node 18+ (frontend), Docker for PostgreSQL, or a local PostgreSQL 16.

**Quickest path: Docker Compose (dev stack)**

```bash
cp backend/.env.example .env
# set JWT_SECRET, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD; optionally SEED_SAMPLE_DATA=true
docker compose up --build -d
# frontend http://localhost:80, admin http://localhost:80/admin, API http://localhost:5001
```

The dev stack is postgres + backend + an nginx container that serves the built frontend and proxies `/api/`. Data lives in the `career-pgdata` volume; local resume fallback in `career-uploads`.

**Manual (hot reload)**

```bash
# database
docker run -d --name careers-pg -e POSTGRES_USER=careers -e POSTGRES_PASSWORD=careers -e POSTGRES_DB=careers -p 5432:5432 postgres:16-alpine

# backend
cd backend && npm install && cp .env.example .env   # edit JWT_SECRET, SEED_ADMIN_*
npm run dev                                          # nodemon on :5001; schema + seed run on boot

# frontend (new terminal)
cd frontend && npm install && cp .env.example .env
npm start                                            # :3000, proxies /api to :5001
```

First boot creates the schema, seeds DPS and Pallavi, the Super Admin and Admin roles, the first super admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, and the pipeline stages. Sample branches and twelve sample openings appear only with `SEED_SAMPLE_DATA=true` on a brand-new database. First sign-in forces a password change.

**Backend environment variables** (all documented in `backend/.env.example`):

| Group | Variables |
| --- | --- |
| Core | `PORT`, `DATABASE_URL`, `PG_POOL_SIZE`, `JWT_SECRET` (required), `APP_TIMEZONE`, `APP_URL` |
| Bootstrap | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_SAMPLE_DATA` |
| Proxy / CORS | `TRUST_PROXY`, `ALLOWED_ORIGINS` |
| Accounts | `INITIAL_USER_PASSWORD`, `INITIAL_PASSWORD_DAYS`, `PASSWORD_RESET_MINUTES`, `SESSION_HOURS`, `TOTP_ISSUER`, `TOTP_CHALLENGE_MINUTES` |
| Anti-spam | `TURNSTILE_SECRET_KEY`, `REQUIRE_FORM_TOKEN`, `REQUIRE_API_KEY`, `FORM_MIN_SECONDS`, `FORM_MAX_SECONDS`, `MAX_APPLICATIONS_PER_DAY`, `RATE_LIMIT_*` |
| Mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` |
| Resumes | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` or `GOOGLE_SERVICE_ACCOUNT_KEY[_FILE]`, plus `GOOGLE_DRIVE_FOLDER_ID` |
| Cache | `REDIS_URL`, `CACHE_TTL_SECONDS`, `CACHE_NAMESPACE` |
| Export | `EXPORT_BATCH_SIZE` |

Frontend variables are read at **build** time: `REACT_APP_TURNSTILE_SITE_KEY`, `REACT_APP_TIMEZONE` (must match `APP_TIMEZONE`), `REACT_APP_API_URL` (leave unset in production).

**Scripts**

| Where | Command | What it does |
| --- | --- | --- |
| backend | `npm start` / `npm run dev` | Run the API (plain / nodemon) |
| backend | `npm test` | All nine suites, serially. Needs a reachable PostgreSQL at `TEST_PG_URL` (default `postgres://careers:careers@localhost:5432`); each file creates and drops `careers_test_<file>` |
| backend | `npm run test:auth`, `test:permissions`, `test:pipeline`, `test:seed`, `test:api-keys`, `test:reports`, `test:openings-api`, `test:anti-spam`, `test:data-api` | One suite |
| backend | `npm run seed` | Schema + seed standalone |
| backend | `npm run api-key -- list \| create \| revoke` | Partner and reporting API keys (`--kind reporting`) |
| frontend | `npm start` / `npm run build` / `npm test` | CRA dev server / production bundle / Jest |

The backend tests spawn the real server (`index.js`) with a test env, wait for `/api/health`, and drive it over HTTP, so routing, middleware, permissions and SQL are exercised exactly as in production. Suites cover sign-in and 2FA, permission ceilings and scope, the pipeline state machine, seeding idempotence, API keys, reports, the public openings feed, and every anti-spam layer.

## 10. Deployment and CI/CD

**Target shape** (see `DEPLOY.md` for the full runbook): one Ubuntu EC2 instance. Docker Compose (`docker-compose.prod.yml`) runs postgres (bound to `127.0.0.1:5432` for SSH-tunnelled GUI clients), PgBouncer, Redis (cache only, no persistence) and the backend (bound to `127.0.0.1:5001`). Host nginx serves `frontend/build`, proxies `/api/` with `client_max_body_size 6M` and `proxy_buffering off` (resume streaming), and terminates TLS via certbot. Port 5001 is never opened to the internet: with `TRUST_PROXY=1`, a direct hit could forge `X-Forwarded-For` and defeat the rate limits.

**Server `.env`** lives at `/var/www/career-application/.env`, is git-ignored, and feeds both compose and the API. Minimum for production: `POSTGRES_*`, `JWT_SECRET`, `SEED_ADMIN_EMAIL` (a real mailbox), `SEED_ADMIN_PASSWORD`, `APP_URL`, `APP_TIMEZONE`, `TRUST_PROXY=1`, `ALLOWED_ORIGINS`, SMTP settings, Google OAuth trio + folder, `TURNSTILE_SECRET_KEY`, and `SEED_SAMPLE_DATA` left empty.

**GitHub Actions** (`.github/workflows/deploy.yml`):

- **Pull request into `main`** → `ci` job on GitHub-hosted Ubuntu with a PostgreSQL service: frontend build with warnings as errors, backend syntax check, full backend test suite.
- **Push to `main`** → `deploy` job on the self-hosted runner, serialized by a concurrency group, in `/var/www/career-application`:
  1. `git reset --hard origin/main`
  2. Verify `.env` exists and required keys are set; warn on missing `TRUST_PROXY`, `ALLOWED_ORIGINS`, `TURNSTILE_SECRET_KEY`
  3. `pg_dump -Fc` of production, verified with `pg_restore --list`; the deploy aborts if the dump fails; last 14 kept
  4. `npm ci && npm run build` in `frontend/`
  5. `docker compose -f docker-compose.prod.yml up -d --build` (never `down -v`)
  6. Health check on `/api/health`, then a row-count comparison of `applications` before/after
  7. Print migrations applied, verify the site through nginx over HTTPS, prune old images

Schema changes ship as code and apply on boot; one-time data migrations are recorded so a redeploy never overwrites an admin's later edits.

## 11. Integrations

| Integration | Where | How it behaves |
| --- | --- | --- |
| **Google Drive** (resumes) | `utils/drive.js` | OAuth refresh token (preferred) or service account on a shared drive. Files are named `<applicant>_<date>_<rand>.pdf` and are **not** shared publicly; admins read them through `GET /api/admin/applications/:id/resume`, which streams from Drive with `Content-Security-Policy: sandbox` and `no-store`. If Drive is unconfigured or fails, the file is written to `backend/uploads/resumes` (the `career-uploads` volume) and served by the same authenticated route. `scripts/revoke-public-resumes.js` strips old public links |
| **SMTP** (mail) | `utils/mailer.js` | Optional. Welcome email with credentials and capability list, password reset code, export approval code to every super admin. When unconfigured, sends are skipped and the API returns the initial password instead |
| **Cloudflare Turnstile** (captcha) | `utils/turnstile.js`, `components/Turnstile.js` | Verified server-side on sign-in, forgot/reset password and the application form when `TURNSTILE_SECRET_KEY` is set; skipped for API-key callers. If Cloudflare is unreachable the check **fails open** and logs. The frontend widget renders only when the site key was present at build time; `GET /api/config` lets the form warn about a mismatch |
| **Redis** (cache) | `utils/cache.js` | Read-through cache with explicit invalidation on every write and a 60 s TTL as a safety net. Fails open. Keys are namespaced by database name so two environments never share entries |
| **Google Tag Manager** | `public/index.html` | Container `GTM-5JN7RCPM` on every page |
| **Attribution** | `src/attribution.js`, `utils/attribution.js` | First-touch UTMs, `gclid`, `fbclid`, landing page and referrer captured in `sessionStorage`, sent with the application, and turned into a `source` label (`gclid` → Google Ads, `fbclid` → Meta Ads, `utm_source` prettified, else Website). Everything beyond `source` is kept for analysis and not shown in the UI |
| **PgBouncer** | `docker-compose.prod.yml` | Transaction pooling; the app uses no session state, so it is safe. Cursors for CSV export run inside one transaction |

## 12. Operations: caching, backups, scripts, startup checks

**What is cached** (`utils/cache.KEYS`): dashboard stats per scope (`stats:<scope>`), active flow options and stage keys (`flow:*`), the admin entity list (`entities:list`), and branch lists per scope (`branches:list:<scope>`). Every controller that writes those tables calls `invalidate()`. Nothing user-specific is cached under a shared key.

**Backups.** PostgreSQL is the only copy of every application and hiring decision; resumes are replicated in Drive. `backend/scripts/backup-db.sh` takes a `pg_dump -Fc` (`RETAIN_DAYS`, default 14) and `--verify` restores it into a scratch database and counts rows. Run nightly by cron to a `BACKUP_DIR` outside the Docker volume and copy off-host. Restore, single-table recovery and the list of commands that destroy data (`docker compose down -v`, `docker volume prune`) are in `backend/scripts/RESTORE.md`. The deploy job also takes a pre-deploy dump.

**Startup configuration review** (`utils/startupChecks.js`) prints `[needs attention]` for: an open write path (no captcha, no form-token requirement, no key requirement), missing SMTP, no active super admin, or super admins with undeliverable addresses; and `[note]` for missing `TRUST_PROXY` or `ALLOWED_ORIGINS`.

**Other scripts**

| Script | Purpose |
| --- | --- |
| `scripts/api-key.js` | Issue / list / revoke partner and reporting keys |
| `scripts/get-google-refresh-token.js` | One-time OAuth consent flow for Drive uploads |
| `scripts/revoke-public-resumes.js` | Remove "anyone with the link" from resumes uploaded before resumes became private |
| `scripts/migrate-sqlite-to-pg.js` | One-time copy from the old SQLite database, preserving ids |
| `scripts/import-legacy-applications.sql` | The 30 pre-launch applications, re-linked to openings by position + branch + entity |

**Security posture in one paragraph.** Admin API locked to configured origins; JSON bodies capped at 256 KB; security headers on every response; bcrypt for passwords and export codes, SHA-256 for API keys and reset codes; constant-time comparisons; per-account and per-IP guess limits; sessions revoked on password change; resumes never public; CSV cells formula-escaped; LIKE wildcards escaped; route ids validated before reaching SQL; container runs as non-root; database and API bound to loopback.

## 13. Known gaps and suggested next steps

Observations from reading the code, in rough priority order.

1. **Stale documentation.** `README.md`, the first line of `backend/README.md`, and all of `backend/db/QUERIES.md` describe SQLite (`careers.db`, `datetime('now')`, `sqlite3` CLI). The code has been PostgreSQL since the "Careers portal for Delhi Public Schools & Pallavi Group of Schools" commit. QUERIES.md also lists only nine permissions. Rewrite or retire them so a new engineer is not misled.
2. **Welcome email omits newer permissions.** `mailer.CAPABILITY_TEXT` has no entries for `applications.manage`, `flow.manage`, `data.import`, `security.manage` or `reports.view`, so those capabilities are silently missing from the "what you can do" list in welcome emails.
3. **Deploys only from `main`, work happens on `dev`.** Nothing reaches production until `dev` is merged. Either open PRs from `dev` to `main` as the release step (which also runs CI) or adjust the workflow triggers.
4. **API keys have no admin UI.** Issuing, listing and revoking is CLI-only over SSH. A `security.manage`-gated page would let the team rotate a partner key without an engineer.
5. **No delete or anonymise for applications.** Candidate PII can only be removed with direct SQL. A retention rule or a super-admin delete with an activity record would help with data-protection requests.
6. **Rate limits are per process.** `express-rate-limit` uses its in-memory store; only the cache uses Redis. Running more than one backend container would multiply every limit by the number of instances. Point the limiters at Redis before scaling out.
7. **Dev compose has no `TRUST_PROXY` and the frontend container's nginx has no `client_max_body_size`.** Through the frontend container, resumes over nginx's 1 MB default fail with 413, and all visitors share one rate-limit bucket. Production host nginx is configured correctly; the dev stack is not.
8. **`REQUIRE_FORM_TOKEN` defaults to false.** The frontend already fetches and returns the token, so enabling it in production adds a layer at no cost, as `backend/README.md` recommends.
9. **Frontend has no real tests.** `App.test.js` is the CRA placeholder looking for "learn react" and would fail if run. Either delete it or add smoke tests for the form and login.
10. **Interview rounds are capped at two** (`MAX_ROUNDS`). Fine today, but the pipeline UI and the round-gating logic assume it; raising it needs both sides.
11. **Turnstile fails open** when Cloudflare is unreachable. Deliberate, but worth knowing when reading logs during an incident.
12. **`applications.qualification`** is no longer collected by the form and is always written as `''`; the column and its `NOT NULL` remain for legacy rows.
13. **Small table hygiene.** `password_resets` and `export_otps` are never pruned; a periodic delete of used or expired rows keeps them tidy.
14. **Session token in `localStorage`.** Standard for this kind of SPA, but any XSS would expose it; the strict CSP on resume responses does not extend to the app itself, which is served by nginx without a CSP header.
