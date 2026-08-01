# Deploying to EC2

Target setup: one Ubuntu EC2 instance running PostgreSQL and the API in Docker,
with host Nginx serving the React build and proxying `/api/` to the API.
Deploys afterwards happen automatically via the GitHub Actions self-hosted
runner on pushes to `main`.

Domain used throughout: `dpgos-careers.k-innovative.com`. Substitute your own.

---

## 1. Launch the instance

| Setting | Value |
|---|---|
| AMI | Ubuntu Server 24.04 LTS |
| Type | `t3.small` minimum, `t3.medium` recommended |
| Storage | 30 GB gp3 |
| Key pair | one you have the `.pem` for |

`t3.small` has 2 GB RAM, which the React build can exhaust. Step 3 adds swap;
with `t3.medium` you can skip it.

**Security group — inbound:**

| Port | Source | Why |
|---|---|---|
| 22 | your IP only | SSH |
| 80 | 0.0.0.0/0 | HTTP, and Let's Encrypt validation |
| 443 | 0.0.0.0/0 | HTTPS |

**Do not open 5001.** The API binds to `127.0.0.1` so Nginx is the only way in.
Exposing it would bypass TLS and let anyone forge `X-Forwarded-For` to get a
fresh rate-limit bucket per request, defeating the sign-in, password-reset and
application-form limits.

Allocate an **Elastic IP** and associate it, or the address changes on restart.

## 2. Point DNS at it

An `A` record for `dpgos-careers.k-innovative.com` → the Elastic IP. Confirm
before continuing, because certificate issuing depends on it:

```bash
dig +short dpgos-careers.k-innovative.com
```

## 3. Prepare the server

```bash
ssh -i your-key.pem ubuntu@<elastic-ip>

sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Kolkata

# Swap: the React build needs more memory than a small instance has
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Install Docker, Node and Nginx

```bash
# Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
newgrp docker    # or log out and back in

# Node 22 (builds the frontend on the host)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Nginx + certbot
sudo apt install -y nginx certbot python3-certbot-nginx

docker --version && node --version && nginx -v
```

## 5. Clone the repository

```bash
sudo mkdir -p /var/www/career-application
sudo chown ubuntu:ubuntu /var/www/career-application
git clone https://github.com/taufeeqahmedmd/career-portal.git /var/www/career-application
cd /var/www/career-application
```

## 6. Create the server `.env`

This file is git-ignored, never overwritten by a deploy, and feeds both Docker
Compose and the API.

```bash
cd /var/www/career-application
cp backend/.env.example .env
openssl rand -base64 48        # copy this for JWT_SECRET
nano .env
```

Minimum for production:

```ini
# Database (compose builds DATABASE_URL from these)
POSTGRES_USER=careers
POSTGRES_PASSWORD=<a long random password>
POSTGRES_DB=careers

JWT_SECRET=<the openssl output>

# The FIRST super admin, created only when the users table is empty.
# Must be a real mailbox: password resets and CSV export approval codes go here.
SEED_ADMIN_EMAIL=careers.admin@yourdomain.com
SEED_ADMIN_PASSWORD=<a strong password you will change at first sign-in>

APP_URL=https://dpgos-careers.k-innovative.com
APP_TIMEZONE=Asia/Kolkata

# REQUIRED behind Nginx. Without it every visitor shares one rate-limit bucket.
TRUST_PROXY=1
ALLOWED_ORIGINS=https://dpgos-careers.k-innovative.com

# Leave EMPTY. Set to true only on a throwaway demo instance, or the careers
# site goes live showing sample vacancies nobody created.
SEED_SAMPLE_DATA=

# Mail - without it, password resets and export approval codes cannot be sent
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<sending account>
SMTP_PASS=<app password>
MAIL_FROM=Careers Portal <no-reply@yourdomain.com>

# Google Drive for resumes. Use the OAuth trio - service-account keys are not
# passed through to the container by docker-compose.prod.yml.
# Mint the refresh token once: node backend/scripts/get-google-refresh-token.js
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=

# Cloudflare Turnstile (captcha). Empty = no captcha on the public form.
TURNSTILE_SECRET_KEY=
```

```bash
chmod 600 .env
```

If Drive is not configured, resumes fall back to the `career-uploads` volume —
still private, served only through the authenticated endpoint.

## 7. First boot

```bash
cd /var/www/career-application
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f backend
```

Expect the schema to be created, your super admin seeded, and a configuration
review listing anything still unset. Then:

```bash
curl -s http://127.0.0.1:5001/api/health     # {"ok":true}
curl -s http://127.0.0.1:5001/api/openings   # {"openings":[]} - correct, add them in the panel
```

## 8. Build the frontend

```bash
cd /var/www/career-application/frontend
cp .env.example .env
nano .env      # REACT_APP_TURNSTILE_SITE_KEY, REACT_APP_TIMEZONE
npm ci
npm run build
```

Create React App reads `.env` at **build** time. Changing it later means
rebuilding.

## 9. Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/careers
```

```nginx
server {
    listen 80;
    server_name dpgos-careers.k-innovative.com;

    root /var/www/career-application/frontend/build;
    index index.html;

    # Resumes are up to 5 MB; Nginx defaults to 1 MB and would reject them
    client_max_body_size 6M;

    access_log /var/log/nginx/careers-access.log;
    error_log  /var/log/nginx/careers-error.log;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location /api/ {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Resume downloads stream from Google Drive
        proxy_read_timeout 120s;
        proxy_buffering off;
    }

    location /static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # React Router: unknown paths render the app
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/careers /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Check over HTTP before adding TLS: `curl -s http://dpgos-careers.k-innovative.com/api/health`

## 10. Enable HTTPS

```bash
sudo certbot --nginx -d dpgos-careers.k-innovative.com --redirect --agree-tos -m you@yourdomain.com
sudo systemctl status certbot.timer     # renewal is automatic
```

Certbot rewrites the site config for 443 and redirects HTTP. Verify:

```bash
curl -s https://dpgos-careers.k-innovative.com/api/health
```

## 11. Nightly backups

The database is the only copy of every application and hiring decision.

```bash
sudo mkdir -p /var/backups/careers && sudo chown ubuntu:ubuntu /var/backups/careers
cd /var/www/career-application
BACKUP_DIR=/var/backups/careers backend/scripts/backup-db.sh --verify

crontab -e
```

```cron
15 2 * * * BACKUP_DIR=/var/backups/careers /var/www/career-application/backend/scripts/backup-db.sh >> /var/log/careers-backup.log 2>&1
```

Copy backups off the machine as well — S3, another host, anywhere that survives
this instance. Restore steps: [backend/scripts/RESTORE.md](backend/scripts/RESTORE.md).

**`docker compose down -v` destroys the database.** Use `down` without `-v`.

## 12. GitHub Actions runner (automatic deploys)

Repository → Settings → Actions → Runners → New self-hosted runner (Linux x64),
then on the server:

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o actions-runner.tar.gz -L <url from the GitHub page>
tar xzf actions-runner.tar.gz
./config.sh --url https://github.com/taufeeqahmedmd/career-portal --token <token from the page>
sudo ./svc.sh install ubuntu
sudo ./svc.sh start
sudo ./svc.sh status
```

The runner user needs Docker access (step 4 added `ubuntu` to the `docker`
group) and write access to `/var/www/career-application`.

From then on, merging into `main` triggers: pre-flight `.env` check → PostgreSQL
backup (deploy aborts if it fails) → frontend build → `compose up -d --build` →
health check → row-count comparison → HTTPS check through Nginx.

## 13. First sign-in

1. Open `https://dpgos-careers.k-innovative.com/admin/login`
2. Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
3. You are required to set a new password before anything else opens
4. Users → turn on **2FA** for your account, scan the QR at next sign-in
5. Configuration → **Entities**, then **Branches**
6. **Job Openings** → add the real vacancies
7. Users → add colleagues (each starts on the temporary password and must
   change it; it expires after `INITIAL_PASSWORD_DAYS`, default 7)

## 14. Verify

```bash
curl -s https://dpgos-careers.k-innovative.com/api/health          # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" https://dpgos-careers.k-innovative.com/   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://<elastic-ip>:5001/api/health       # must FAIL
docker compose -f docker-compose.prod.yml ps                        # both healthy
ls -la /var/backups/careers                                         # a backup exists
```

Then in a browser: submit a test application, confirm it appears in the admin
panel, open the applicant and check the resume preview loads. Delete the test
application afterwards.

---

## Troubleshooting

**413 on resume upload** — `client_max_body_size` missing from the Nginx site.

**Everyone rate-limited at once** — `TRUST_PROXY=1` not set, so all visitors
share one bucket. Set it and restart the backend.

**Password reset or CSV export codes never arrive** — SMTP unset, or
`SEED_ADMIN_EMAIL` is not a real mailbox. A super admin can change a user's
email from the Users page.

**The captcha blocks every submission** — `TURNSTILE_SECRET_KEY` is set on the
backend but `REACT_APP_TURNSTILE_SITE_KEY` was missing when the frontend was
built. Set it and rebuild.

**The build runs out of memory** — add swap (step 3) or use a larger instance.

**`502 Bad Gateway`** — the API is down: `docker compose -f docker-compose.prod.yml logs --tail 50 backend`.
