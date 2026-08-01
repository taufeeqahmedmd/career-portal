# Backup and restore

The PostgreSQL database is the only copy of every application, screening note
and interview decision. Resumes are in Google Drive and replicated there;
nothing else is.

## Taking backups

```bash
# once, to check it works
BACKUP_DIR=/var/backups/careers backend/scripts/backup-db.sh --verify

# nightly, via cron
15 2 * * * BACKUP_DIR=/var/backups/careers /opt/careers/backend/scripts/backup-db.sh >> /var/log/careers-backup.log 2>&1
```

`BACKUP_DIR` must be **outside** the Docker volume. A backup stored in the
volume it is protecting is lost with it.

Keep a copy off the machine as well — object storage, another server, anywhere
that survives the server dying. Two backups on one disk is one backup.

## Restoring

**Restoring replaces the database. Take a fresh dump of the current state
first, even if it is broken — you may need to compare against it.**

```bash
# 1. Stop the app so nothing writes during the restore
docker compose -f docker-compose.prod.yml stop backend

# 2. Keep whatever is there now
docker exec career-app-postgres pg_dump -U careers -d careers -Fc > /tmp/before-restore.dump

# 3. Recreate an empty database
docker exec career-app-postgres psql -U careers -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='careers'" \
  -c "DROP DATABASE careers" \
  -c "CREATE DATABASE careers OWNER careers"

# 4. Load the backup
docker exec -i career-app-postgres pg_restore -U careers -d careers --no-owner \
  < /var/backups/careers/careers_2026-08-01_021500.dump

# 5. Check before starting up
docker exec career-app-postgres psql -U careers -d careers -tAc \
  "SELECT (SELECT COUNT(*) FROM applications) || ' applications, ' ||
          (SELECT COUNT(*) FROM users) || ' users'"

# 6. Start the app - it reapplies any schema changes the code needs
docker compose -f docker-compose.prod.yml start backend
```

Step 6 matters: the running code may be newer than the backup. `initSchema()`
adds any missing columns on boot, and one-time migrations are tracked in
`app_settings` under `migration:*`, so they do not reapply to rows an admin has
since edited.

## Recovering a single table

The custom format restores selectively, which is what you want when one table
was damaged and the rest is fine:

```bash
docker exec -i career-app-postgres pg_restore -U careers -d careers \
  --data-only --table=applications < backup.dump
```

## Things that destroy data

- **`docker compose down -v`** — the `-v` deletes the `career-pgdata` volume and
  every row in it. There is no undo. Use `down` without `-v` to stop the stack.
- **`docker volume prune`** — removes volumes not attached to a running
  container. If the stack is stopped, that includes this one.
- Pointing a local `.env` at the production `DATABASE_URL`. Local runs seed and
  migrate on boot; against production that is a live write.

## Verifying a backup is real

A dump that parses is not the same as a dump that restores. `--verify` restores
into a scratch database and counts the rows that came back. Run it at least
monthly — an untested backup is a guess.
