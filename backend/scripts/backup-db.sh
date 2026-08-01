#!/usr/bin/env bash
#
# Nightly PostgreSQL backup for the careers portal.
#
# The database is the only copy of every application, screening note and
# interview decision. Resumes live in Google Drive and are replicated there;
# nothing else is.
#
#   ./backup-db.sh                  # write a backup, prune old ones
#   ./backup-db.sh --verify         # also restore it into a scratch database
#
# Cron (2:15am daily), writing to a directory OUTSIDE the docker volume:
#   15 2 * * * BACKUP_DIR=/var/backups/careers /opt/careers/backend/scripts/backup-db.sh >> /var/log/careers-backup.log 2>&1
#
# Environment:
#   BACKUP_DIR      where to write            (default ./backups)
#   RETAIN_DAYS     how long to keep them     (default 14)
#   PG_CONTAINER    docker container name     (default career-app-postgres)
#   PGUSER/PGDATABASE                          (default careers/careers)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
PG_CONTAINER="${PG_CONTAINER:-career-app-postgres}"
PGUSER="${PGUSER:-careers}"
PGDATABASE="${PGDATABASE:-careers}"

timestamp="$(date +%Y-%m-%d_%H%M%S)"
target="${BACKUP_DIR}/careers_${timestamp}.dump"

mkdir -p "$BACKUP_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  echo "ERROR: container '${PG_CONTAINER}' is not running. Nothing was backed up." >&2
  exit 1
fi

echo "[$(date -Is)] Backing up ${PGDATABASE} -> ${target}"

# -Fc is the custom format: compressed, and restorable table by table
docker exec "$PG_CONTAINER" pg_dump -U "$PGUSER" -d "$PGDATABASE" -Fc > "$target"

# A dump that is empty or truncated is worse than none, because it looks like a
# backup. Check it is a valid archive before trusting it.
if ! docker exec -i "$PG_CONTAINER" pg_restore --list < "$target" > /dev/null 2>&1; then
  echo "ERROR: the dump did not verify. Keeping it for inspection: ${target}" >&2
  exit 1
fi

size="$(du -h "$target" | cut -f1)"
tables="$(docker exec -i "$PG_CONTAINER" pg_restore --list < "$target" | grep -c 'TABLE DATA' || true)"
echo "[$(date -Is)] Wrote ${size}, ${tables} table(s) with data"

# Optional: prove the dump actually restores, not just that it parses
if [ "${1:-}" = "--verify" ]; then
  scratch="careers_restore_check_$$"
  echo "[$(date -Is)] Test-restoring into ${scratch}"
  docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE ${scratch}" > /dev/null
  docker exec -i "$PG_CONTAINER" pg_restore -U "$PGUSER" -d "$scratch" --no-owner < "$target" > /dev/null 2>&1 || true
  count="$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d "$scratch" -tAc 'SELECT COUNT(*) FROM applications')"
  docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE ${scratch}" > /dev/null
  echo "[$(date -Is)] Restore check: ${count} application(s) came back"
fi

# Prune, but never leave zero backups behind
kept="$(find "$BACKUP_DIR" -name 'careers_*.dump' -type f | wc -l)"
if [ "$kept" -gt 1 ]; then
  find "$BACKUP_DIR" -name 'careers_*.dump' -type f -mtime "+${RETAIN_DAYS}" -print -delete
fi

echo "[$(date -Is)] Done. ${BACKUP_DIR} holds $(find "$BACKUP_DIR" -name 'careers_*.dump' | wc -l) backup(s)."
