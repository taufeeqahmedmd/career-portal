CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- JSON array of permission keys; '*' grants everything
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system   INTEGER NOT NULL DEFAULT 0,
  -- Inactive roles cannot be assigned to users; existing holders are unaffected
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness (SQLite had COLLATE NOCASE)
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_name_lower ON roles (LOWER(name));

-- School groups (e.g. DPS, Pallavi) - managed from the admin UI
CREATE TABLE IF NOT EXISTS entities (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#1e3a8a',
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entities_code_lower ON entities (LOWER(code));

CREATE TABLE IF NOT EXISTS branches (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  school_group TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_group_name_lower
  ON branches (school_group, LOWER(name));

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),
  -- Entity code; NULL = access to all entities
  school_group  TEXT,
  -- NULL = whole entity; set = scoped to that single branch
  branch_id     INTEGER REFERENCES branches(id),
  role_id       INTEGER REFERENCES roles(id),
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  -- Tokens issued before this moment are rejected, so a password reset
  -- immediately kills any session opened with the old credentials
  password_changed_at TIMESTAMPTZ,
  -- New accounts start on a shared initial password and cannot use the portal
  -- until they have replaced it
  must_change_password INTEGER NOT NULL DEFAULT 0,
  -- Two-factor authentication (TOTP, RFC 6238). The secret is created at
  -- enrolment and only trusted once the user has proved a code from it.
  totp_enabled       INTEGER NOT NULL DEFAULT 0,
  totp_secret        TEXT,
  totp_confirmed_at  TIMESTAMPTZ,
  -- Last accepted time step; blocks replay of a code inside its 30s window
  totp_last_step     BIGINT,
  -- Failed code guesses since the last successful one; capped per account so a
  -- distributed attacker cannot brute-force six digits through the per-IP limit
  totp_attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email));

-- Emailed one-time codes for the "forgot password" flow
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- Global switches a super admin controls from the portal
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS openings (
  id            SERIAL PRIMARY KEY,
  position      TEXT NOT NULL,
  branch        TEXT NOT NULL,
  school_group  TEXT NOT NULL,
  eligibility   TEXT NOT NULL DEFAULT '',
  -- Academic roles carry a curriculum; non-academic ones never do
  category      TEXT NOT NULL DEFAULT 'Academic' CHECK (category IN ('Academic', 'Non-Academic')),
  curriculum    TEXT CHECK (curriculum IN ('CBSE', 'CIE')),
  created_by_id INTEGER REFERENCES users(id),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
  id                     SERIAL PRIMARY KEY,
  full_name              TEXT NOT NULL,
  mobile                 TEXT NOT NULL,
  email                  TEXT NOT NULL,
  qualification          TEXT NOT NULL,
  opening_id             INTEGER REFERENCES openings(id),
  position               TEXT NOT NULL,
  branch                 TEXT NOT NULL,
  school_group           TEXT NOT NULL,
  referral_employee_code TEXT NOT NULL DEFAULT '',
  referral_employee_name TEXT DEFAULT '',
  referral_employee_contact TEXT DEFAULT '',
  referral_employee_branch TEXT DEFAULT '',
  experience_years       TEXT DEFAULT '',
  current_company        TEXT DEFAULT '',
  resume_link            TEXT DEFAULT '',
  resume_file_id         TEXT DEFAULT '',
  -- Where the applicant came from. `source` is the readable label shown in the
  -- admin table; the rest is kept for analysis and is not surfaced in the UI.
  source                 TEXT NOT NULL DEFAULT 'Website',
  utm_source             TEXT DEFAULT '',
  utm_medium             TEXT DEFAULT '',
  utm_campaign           TEXT DEFAULT '',
  utm_term               TEXT DEFAULT '',
  utm_content            TEXT DEFAULT '',
  gclid                  TEXT DEFAULT '',
  fbclid                 TEXT DEFAULT '',
  -- JSON: any other query params, landing page and referrer
  tracking_params        TEXT DEFAULT '',
  -- Hiring pipeline: screening stage captured by the admin team
  screening_experience      TEXT DEFAULT '',
  screening_current_salary  TEXT DEFAULT '',
  screening_expected_salary TEXT DEFAULT '',
  screening_comments        TEXT DEFAULT '',
  screening_location        TEXT DEFAULT '',
  screening_relocate        INTEGER NOT NULL DEFAULT 0,
  screening_status          TEXT DEFAULT '',
  screening_next_round      INTEGER NOT NULL DEFAULT 0,
  -- Optional handoff to another branch after screening
  referred_entity           TEXT DEFAULT '',
  referred_branch           TEXT DEFAULT '',
  suggested_role            TEXT DEFAULT '',
  -- Bumped whenever the hiring pipeline is updated; NULL = no activity yet
  last_activity_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(created_at);
CREATE INDEX IF NOT EXISTS idx_applications_opening ON applications(opening_id);
-- One application per position per phone number is enforced by a unique index.
-- It is created in db/init.js rather than here, because an existing database
-- may already hold duplicates that would make this statement - and therefore
-- the whole schema load - fail on boot.

-- Interview rounds unlocked after screening moves the candidate forward
CREATE TABLE IF NOT EXISTS interview_rounds (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  round_no       INTEGER NOT NULL,
  assigned_to    INTEGER REFERENCES users(id),
  assigned_name  TEXT NOT NULL DEFAULT '',
  feedback       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'in_process',
  -- "Next Interview Round?" answer - opens the following round
  next_round     INTEGER NOT NULL DEFAULT 0,
  updated_by     INTEGER REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, round_no)
);

-- One-time codes that authorise a CSV export; approved by a super admin
CREATE TABLE IF NOT EXISTS export_otps (
  id           SERIAL PRIMARY KEY,
  code_hash    TEXT NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  sent_to      TEXT NOT NULL DEFAULT '',
  -- The exact filter set the super admin approved; the download must match
  filter_key   TEXT NOT NULL DEFAULT '',
  attempts     INTEGER NOT NULL DEFAULT 0,
  used_at      TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_export_otps_user ON export_otps(requested_by);

-- Timeline of everything that happened to an application
CREATE TABLE IF NOT EXISTS application_activity (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  action         TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  actor_id       INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_application ON application_activity(application_id);

-- Configurable dropdown values for the hiring pipeline (Flow Configuration page)
CREATE TABLE IF NOT EXISTS flow_options (
  id         SERIAL PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('profile_stage', 'assignee', 'suggested_role')),
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#78716c',
  -- Roles/positions are Academic or Non-Academic so the opening form can filter
  category   TEXT NOT NULL DEFAULT 'Academic',
  -- System values are load-bearing (e.g. 'new' is the automatic first status)
  is_system  INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, key)
);
