# Careers Referral Portal

Referral-based careers portal for **Delhi Public Schools & Pallavi Group of Schools**. Teachers share this page with candidates; the candidate (or the teacher on their behalf) submits a short application with the referring employee's code. All data is stored in a local **SQLite** database, and an **admin panel** at `/admin` lets HR view/export applications, manage job openings, and manage admin users.

## Features

- Public careers page listing active job openings (position + branch) for both school groups
- 2-step referral application form: Full Name, Mobile, Email, Qualification, Position, Referral Employee ID
- SQLite storage — no external services required
- Admin panel (`/admin`):
  - JWT login
  - **Applications**: search, filter by school group / position / date, CSV export
  - **Job Openings**: add, edit, close/reopen (drives the public page and form dropdown)
  - **Users** (super admin only): add admins, activate/deactivate accounts

## Quick Start with Docker 🐳

```bash
# Copy environment template and configure
cp backend/.env.example .env
# Edit .env - set JWT_SECRET, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD

# Build and start all services
docker compose up --build -d
```

The application will be available at:
- **Frontend**: http://localhost:80 (admin panel at http://localhost:80/admin)
- **Backend API**: http://localhost:5001

The first super admin is created automatically from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` when the database is empty. The SQLite database persists in the `career-data` Docker volume.

### Docker Commands Reference

```bash
docker compose up -d              # Start services
docker compose down               # Stop services (data persists in the volume)
docker compose up --build -d      # Rebuild and restart
docker compose logs -f            # View logs
docker compose ps                 # Check service status
```

## Manual Setup (Development)

### Prerequisites

- Node.js v18 or higher

### Installation

```bash
# Backend
cd backend
npm install
cp .env.example .env   # edit values
npm start              # runs on http://localhost:5001

# Frontend (new terminal)
cd frontend
npm install
npm start              # runs on http://localhost:3000, proxies /api to :5001
```

On first start the backend creates `backend/data/careers.db`, applies the schema, seeds the initial super admin (from env), and seeds a default set of job openings if none exist.

### Environment Variables (backend/.env)

| Variable | Description |
|----------|-------------|
| `PORT` | Backend port (default 5001) |
| `DB_PATH` | SQLite file path (default `backend/data/careers.db`; `/app/data/careers.db` in Docker) |
| `JWT_SECRET` | Secret for signing admin JWTs — required, use a long random string |
| `SEED_ADMIN_EMAIL` | Email of the first super admin (used only when users table is empty) |
| `SEED_ADMIN_PASSWORD` | Password of the first super admin |

## API Overview

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | – | Healthcheck |
| GET | `/api/openings` | – | Active openings |
| POST | `/api/applications` | – | Submit a referral application |
| POST | `/api/admin/login` | – | Admin login → JWT |
| GET | `/api/admin/me` | JWT | Current user |
| GET/POST/PUT | `/api/admin/openings[/:id]` | JWT | Manage openings |
| GET | `/api/admin/applications` | JWT | List/filter applications |
| GET | `/api/admin/applications/export` | JWT | CSV export |
| GET/POST/PATCH | `/api/admin/users[/:id]` | JWT (super admin) | Manage admin users |

## GitHub Actions CI/CD 🚀

On push to `main`/`master`, the workflow builds the backend Docker image, pushes it to GHCR, and deploys (self-hosted runner path builds the frontend on the host).

### Server .env (one-time setup)

The deploy does **not** generate `.env` — it expects a persistent `.env` file in the project root on the server (`/var/www/career-application/.env`) and fails if it's missing. Create it once:

```bash
cd /var/www/career-application
cp backend/.env.example .env
# edit: set JWT_SECRET, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
```

The file is git-ignored, so `git pull` during deploys never touches it. No GitHub repository secrets are needed for the self-hosted deploy. (Only the SSH deploy variant uses secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`.)

### One-time host Nginx setup (production)

The production deploy serves the frontend build via the **host** Nginx (not the frontend container), so the host Nginx site config must proxy the API once:

```nginx
location /api/ {
    proxy_pass http://localhost:5001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Backup

All data lives in a single SQLite file. Back up the `career-data` Docker volume (or `backend/data/careers.db` in manual setups) regularly:

```bash
docker compose exec backend sh -c "cp /app/data/careers.db /app/data/careers-backup.db"
docker cp career-app-backend:/app/data/careers-backup.db ./careers-backup.db
```

## Project Structure

```
career-application/
├── backend/                 # Node.js/Express API
│   ├── controllers/         # Route handlers (auth, openings, applications, users)
│   ├── db/                  # SQLite connection, schema, seed
│   ├── middlewares/         # JWT auth + role checks
│   ├── routes/              # public.js (/api) and admin.js (/api/admin)
│   ├── utils/               # CSV serializer
│   └── index.js             # Entry point
├── frontend/                # React application
│   ├── src/admin/           # Admin panel (login, applications, openings, users)
│   ├── src/components/      # Public page components
│   ├── src/services/api.js  # Axios API client
│   └── nginx.conf           # Nginx configuration (Docker)
├── .github/workflows/       # GitHub Actions
├── docker-compose.yml       # Full stack (frontend + backend)
├── docker-compose.prod.yml  # Backend only (host Nginx serves frontend)
├── Dockerfile.backend
└── Dockerfile.frontend
```
