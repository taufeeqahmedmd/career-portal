# Server-Side Query Reference

Hand-run SQL for administering the careers database directly, covering users, job
openings, entities, branches, roles and applications. The schema lives in
[schema.sql](schema.sql); the API controllers in `backend/controllers/` perform the same
operations with validation on top.

> **Prefer the admin UI / API when possible.** Direct SQL bypasses validation,
> permission checks, duplicate detection and the welcome email sent on user creation.
> Use these queries for bootstrapping, repairs and one-off maintenance.

## Connecting to the database

The database is SQLite, located at `backend/data/careers.db` (override with the
`DB_PATH` env var). It runs in WAL mode.

```bash
# From the repo root
sqlite3 backend/data/careers.db

# Recommended session pragmas
.headers on
.mode column
PRAGMA foreign_keys = ON;
```

**Back up first** for anything destructive:

```bash
sqlite3 backend/data/careers.db ".backup backend/data/careers-backup.db"
```

If the server is running, writes are safe (WAL allows concurrent access), but avoid
long-running transactions from the CLI.

All timestamps are stored as UTC via `datetime('now')`. Boolean columns
(`is_active`, `is_system`) are integers: `1` = true, `0` = false.

---

## Users

Users reference a role via `role_id` and are scoped by `school_group` (an entity
`code`, `NULL` = all entities) and optionally `branch_id` (`NULL` = whole entity).
The legacy `role` column must still be set for its CHECK constraint: use
`'super_admin'` for roles whose permissions include `'*'`, otherwise `'admin'`.

### List users (with role and branch names)

```sql
SELECT u.id, u.email, u.name, u.school_group, b.name AS branch, r.name AS role,
       u.is_active, u.last_login_at, u.created_at
FROM users u
LEFT JOIN branches b ON b.id = u.branch_id
LEFT JOIN roles r    ON r.id = u.role_id
ORDER BY u.created_at;
```

### Add a user

Passwords are bcrypt hashes (cost 10). Generate one first:

```bash
node -e "console.log(require('bcryptjs').hashSync('THE_PASSWORD', 10))"
```

Run this from the `backend/` directory so `bcryptjs` resolves. Then:

```sql
-- Scoped admin (entity-wide access to Pallavi)
INSERT INTO users (email, name, password_hash, role, role_id, school_group, branch_id)
VALUES (
  'jane@example.com',
  'Jane Doe',
  '$2b$10$...paste hash here...',
  'admin',
  (SELECT id FROM roles WHERE name = 'Admin'),
  'Pallavi',
  NULL
);

-- Branch-scoped admin
INSERT INTO users (email, name, password_hash, role, role_id, school_group, branch_id)
VALUES (
  'branch.admin@example.com',
  'Branch Admin',
  '$2b$10$...',
  'admin',
  (SELECT id FROM roles WHERE name = 'Admin'),
  (SELECT school_group FROM branches WHERE id = 3),
  3
);

-- Super admin (no scope)
INSERT INTO users (email, name, password_hash, role, role_id)
VALUES (
  'root@example.com',
  'Super Admin',
  '$2b$10$...',
  'super_admin',
  (SELECT id FROM roles WHERE name = 'Super Admin')
);
```

Rules the API enforces that you must keep manually:
- `email` is unique (case-insensitive).
- When `branch_id` is set, `school_group` must equal that branch's `school_group`.
- Users with an unrestricted role (`'*'` permissions) should have
  `school_group = NULL` and `branch_id = NULL`.

### Modify a user

```sql
-- Rename
UPDATE users SET name = 'New Name' WHERE email = 'jane@example.com';

-- Reset password (hash generated as above)
UPDATE users SET password_hash = '$2b$10$...' WHERE email = 'jane@example.com';

-- Change role (keep the legacy column in sync)
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'Admin'),
    role    = 'admin'
WHERE email = 'jane@example.com';

-- Re-scope to a different entity (entity-wide)
UPDATE users SET school_group = 'DPS', branch_id = NULL WHERE email = 'jane@example.com';

-- Re-scope to a single branch
UPDATE users
SET branch_id    = (SELECT id FROM branches WHERE name = 'Pallavi Model School, Alwal'),
    school_group = (SELECT school_group FROM branches WHERE name = 'Pallavi Model School, Alwal')
WHERE email = 'jane@example.com';
```

### Deactivate / reactivate / delete a user

Deactivation is the supported "remove" — it blocks login but preserves history:

```sql
UPDATE users SET is_active = 0 WHERE email = 'jane@example.com';  -- deactivate
UPDATE users SET is_active = 1 WHERE email = 'jane@example.com';  -- reactivate
```

Hard delete (the API never does this; `openings.created_by_id` references the user, so
clear it first):

```sql
UPDATE openings SET created_by_id = NULL
WHERE created_by_id = (SELECT id FROM users WHERE email = 'jane@example.com');
DELETE FROM users WHERE email = 'jane@example.com';
```

---

## Job openings

`openings.branch` and `openings.school_group` are plain text that must match an
active row in `branches` (`branches.name` + `branches.school_group`) and an active
entity `code`. `curriculum` is optional and must be `'CBSE'` or `'CIE'` if set.

### List openings

```sql
-- Active (what the public site shows)
SELECT id, position, branch, school_group, curriculum
FROM openings WHERE is_active = 1
ORDER BY school_group, branch, position;

-- All, with creator
SELECT o.id, o.position, o.branch, o.school_group, o.is_active,
       u.name AS created_by, o.created_at
FROM openings o
LEFT JOIN users u ON u.id = o.created_by_id
ORDER BY o.is_active DESC, o.school_group, o.branch, o.position;
```

### Add an opening

```sql
INSERT INTO openings (position, branch, school_group, eligibility, curriculum, created_by_id)
VALUES (
  'TGT - Mathematics',
  'Pallavi Model School, Alwal',        -- must match branches.name for that group
  'Pallavi',                            -- must match an active entities.code
  'Postgraduates / Graduates with B.Ed. having minimum 2 years'' experience.',
  'CBSE',                               -- or 'CIE', or NULL
  (SELECT id FROM users WHERE email = 'root@example.com')
);
```

### Modify an opening

Always touch `updated_at` when editing:

```sql
UPDATE openings
SET position = 'PGT - Physics',
    eligibility = 'Postgraduate with B.Ed. and 3 years'' experience.',
    updated_at = datetime('now')
WHERE id = 12;
```

### Close / reopen / delete an opening

Closing (`is_active = 0`) is the standard removal — it hides the opening from the
public site but keeps applications linked to it:

```sql
UPDATE openings SET is_active = 0, updated_at = datetime('now') WHERE id = 12;  -- close
UPDATE openings SET is_active = 1, updated_at = datetime('now') WHERE id = 12;  -- reopen
```

Hard delete (applications keep their copied position/branch text, but detach the
foreign key first):

```sql
UPDATE applications SET opening_id = NULL WHERE opening_id = 12;
DELETE FROM openings WHERE id = 12;
```

---

## Entities (school groups)

`entities.code` (e.g. `DPS`, `Pallavi`) is the join key used by
`branches.school_group`, `openings.school_group`, `users.school_group` and
`applications.school_group`. **Never change a code once in use.** Codes are 2–20
letters/numbers/hyphens; `color` is a hex value like `#1e3a8a`.

### List entities with usage counts

```sql
SELECT e.*,
  (SELECT COUNT(*) FROM branches  WHERE school_group = e.code) AS branches,
  (SELECT COUNT(*) FROM openings  WHERE school_group = e.code AND is_active = 1) AS active_openings,
  (SELECT COUNT(*) FROM users     WHERE school_group = e.code) AS users,
  (SELECT COUNT(*) FROM applications WHERE school_group = e.code) AS applications
FROM entities e ORDER BY e.name;
```

### Add / modify an entity

```sql
INSERT INTO entities (code, name, color) VALUES ('NGS', 'New Group of Schools', '#0f766e');

UPDATE entities SET name = 'Renamed Group', color = '#7c2d12' WHERE code = 'NGS';
```

### Deactivate / delete an entity

Deactivate to retire an entity that has data (hides it from the public site and from
new assignments):

```sql
UPDATE entities SET is_active = 0 WHERE code = 'NGS';
```

Delete only when unused — run the usage-count query above first; the API refuses to
delete an entity referenced by any branch, opening, user or application:

```sql
DELETE FROM entities WHERE code = 'NGS';
```

---

## Branches

Branches are unique per `(school_group, name)` (name is case-insensitive).
`openings.branch` matches `branches.name` by text, so **renaming a branch orphans its
openings** — update them together.

### List branches

```sql
SELECT b.*, COUNT(o.id) AS active_openings
FROM branches b
LEFT JOIN openings o
  ON o.branch = b.name AND o.school_group = b.school_group AND o.is_active = 1
GROUP BY b.id
ORDER BY b.school_group, b.name;
```

### Add a branch

```sql
INSERT INTO branches (name, school_group)
VALUES ('Pallavi Model School, Kompally', 'Pallavi');   -- school_group = active entity code
```

### Rename a branch (keep openings in sync)

```sql
BEGIN;
UPDATE openings
SET branch = 'New Branch Name', updated_at = datetime('now')
WHERE branch = 'Old Branch Name' AND school_group = 'Pallavi';

UPDATE branches
SET name = 'New Branch Name'
WHERE name = 'Old Branch Name' AND school_group = 'Pallavi';
COMMIT;
```

### Deactivate / delete a branch

```sql
UPDATE branches SET is_active = 0 WHERE id = 7;   -- hide from public site & new assignments
```

Before deleting, close its active openings (the API requires this) and check that no
user is scoped to it:

```sql
SELECT COUNT(*) FROM openings
WHERE branch = (SELECT name FROM branches WHERE id = 7)
  AND school_group = (SELECT school_group FROM branches WHERE id = 7)
  AND is_active = 1;                              -- must be 0

SELECT id, email FROM users WHERE branch_id = 7;  -- re-scope these users first

DELETE FROM branches WHERE id = 7;
```

---

## Roles

`permissions` is a JSON array of keys from `backend/utils/permissions.js`:

| Key | Grants |
|---|---|
| `*` | Everything (reserved for the system Super Admin role) |
| `applications.view` | View applications |
| `applications.export` | Export applications (CSV) |
| `openings.view` | View job openings |
| `openings.manage` | Add & edit job openings |
| `branches.manage` | Manage branches |
| `entities.manage` | Manage entities (school groups) |
| `users.manage` | Manage users (within scope) |
| `roles.manage` | Manage roles & assign roles to users |

The seeded `Super Admin` and `Admin` roles are system roles (`is_system = 1`): they
cannot be deleted, Super Admin cannot be modified, and system roles cannot be renamed
or deactivated.

### List roles with user counts

```sql
SELECT r.*, (SELECT COUNT(*) FROM users WHERE role_id = r.id) AS users_count
FROM roles r ORDER BY r.is_system DESC, r.name;
```

### Add a role

```sql
INSERT INTO roles (name, description, permissions)
VALUES (
  'Recruiter',
  'Views and exports applications only',
  '["applications.view","applications.export","openings.view"]'
);
```

### Modify a role

```sql
UPDATE roles
SET description = 'Handles openings and applications',
    permissions = '["applications.view","openings.view","openings.manage"]'
WHERE name = 'Recruiter';

-- Deactivate: existing holders keep it, but it can no longer be assigned
UPDATE roles SET is_active = 0 WHERE name = 'Recruiter';
```

### Delete a role

Reassign its users first — `users.role_id` references it:

```sql
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'Admin'), role = 'admin'
WHERE role_id = (SELECT id FROM roles WHERE name = 'Recruiter');

DELETE FROM roles WHERE name = 'Recruiter' AND is_system = 0;
```

---

## Applications

Applications are submitted from the public careers site. Position, branch and
school_group are copied onto the row at submit time, so they survive opening edits.
Duplicates (same `opening_id` + same mobile or email) are rejected by the API.

### List / search

```sql
-- Latest 20
SELECT * FROM applications ORDER BY created_at DESC, id DESC LIMIT 20;

-- Search by name / email / mobile / referral code
SELECT * FROM applications
WHERE full_name LIKE '%kumar%' OR email LIKE '%kumar%'
   OR mobile LIKE '%98480%' OR referral_employee_code LIKE '%EMP1%'
ORDER BY created_at DESC;

-- Filter by group and date range (dates are UTC)
SELECT * FROM applications
WHERE school_group = 'Pallavi'
  AND date(created_at) >= date('2026-07-01')
  AND date(created_at) <= date('2026-07-31')
ORDER BY created_at DESC;

-- Counts by group + today's total
SELECT school_group, COUNT(*) AS count FROM applications GROUP BY school_group;
SELECT COUNT(*) FROM applications WHERE date(created_at) = date('now');
```

### Add an application manually

```sql
INSERT INTO applications
  (full_name, mobile, email, qualification, opening_id, position, branch, school_group, referral_employee_code)
SELECT 'Ravi Kumar', '9848012345', 'ravi@example.com', 'M.Sc., B.Ed.',
       o.id, o.position, o.branch, o.school_group, 'EMP1234'
FROM openings o WHERE o.id = 12 AND o.is_active = 1;
```

(Mobile should be exactly 10 digits; the `SELECT` form copies position/branch/group
from the opening the way the API does.)

### Remove applications

There is no API for this — deletion is direct SQL only. Back up first.

```sql
DELETE FROM applications WHERE id = 123;

-- Remove duplicates for one opening, keeping the earliest per email
DELETE FROM applications
WHERE opening_id = 12
  AND id NOT IN (
    SELECT MIN(id) FROM applications WHERE opening_id = 12 GROUP BY LOWER(email)
  );
```

### Export to CSV

```bash
sqlite3 -header -csv backend/data/careers.db \
  "SELECT id, full_name, mobile, email, qualification, position, branch, school_group,
          referral_employee_code, created_at
   FROM applications ORDER BY created_at DESC;" > applications.csv
```

---

## Cross-cutting notes

- **Soft delete first.** Every entity-like table has `is_active`; the admin UI treats
  deactivation as the normal removal path and only hard-deletes unused rows.
- **Referential text joins.** `openings.branch` ↔ `branches.name` and every
  `school_group` column ↔ `entities.code` are joined by value, not by foreign key.
  Keep them consistent when renaming.
- **Foreign keys** (`users.role_id`, `users.branch_id`, `openings.created_by_id`,
  `applications.opening_id`) are declared but only enforced when the connection sets
  `PRAGMA foreign_keys = ON` (the app does; set it in your CLI session too).
- **Seeding.** On startup with an empty database, `db/seed.js` creates the DPS and
  Pallavi entities, the Super Admin / Admin system roles, the first super admin from
  `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, and default branches/openings.
  Seeding is idempotent and never resurrects intentionally deleted data.
