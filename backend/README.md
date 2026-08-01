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
