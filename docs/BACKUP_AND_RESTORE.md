# Backup and Restore

## Scripts

- `scripts/backup-db.sh` — creates a compressed, timestamped logical backup (`pg_dump -Fc`, custom format) of the running `docker-compose` Postgres instance, written to `backups/devforge-<UTC timestamp>.dump` (gitignored — never committed). Runs `pg_dump` *inside* the `postgres` container via `docker compose exec`, so no local Postgres client tooling is required on the host, and the dump always uses the exact server-matching `pg_dump` version.
- `scripts/restore-db.sh` — restores a `.dump` file produced by `backup-db.sh` via `pg_restore --clean --if-exists --no-owner`, also run inside the container. **Defaults to restoring into a fresh, disposable `devforge_restore_test` database, never the live `devforge` database**, so an accidental restore can never silently discard data written since the backup. Restoring over the real database requires explicitly passing `RESTORE_TARGET_DB=devforge`, which triggers a 5-second countdown warning before proceeding.

## Usage

```bash
# Take a backup
bash scripts/backup-db.sh
# -> Backup complete: backups/devforge-20260101T000000Z.dump (NN K)

# Restore it into a disposable database (safe default — verifies the backup is restorable)
BACKUP_FILE=backups/devforge-20260101T000000Z.dump bash scripts/restore-db.sh

# Restore it OVER the live database (only during an actual incident, and only
# after taking a fresh backup of current state first)
RESTORE_TARGET_DB=devforge BACKUP_FILE=backups/devforge-20260101T000000Z.dump bash scripts/restore-db.sh
```

Both scripts respect `COMPOSE_SERVICE` (default `postgres`), `PGUSER` (default `devforge`), `PGDATABASE`/`RESTORE_TARGET_DB`, and `BACKUP_DIR` — the defaults match `docker-compose.yml` and need no overrides for the standard local deployment.

## Verified end-to-end (Phase 17)

This was not just written and assumed to work — it was run against real data: a user was registered through the live API, a backup was taken, that backup was restored into a fresh disposable database, and the row count in `users` was confirmed to match exactly between the source and restored database. Re-run this verification any time the schema or scripts change:

```bash
docker compose up -d
# register a user via the live API, e.g.:
curl -s -X POST http://localhost:4000/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"backup-check@example.com","password":"a-real-password-123","name":"Backup Check"}'

bash scripts/backup-db.sh
BACKUP_FILE=backups/devforge-<the timestamp just printed>.dump bash scripts/restore-db.sh
# -> prints "Sanity check — rows in the users table after restore: N"
# compare N against: docker compose exec postgres psql -U devforge -d devforge -tAc "SELECT count(*) FROM users;"
```

## Recovery Point Objective (RPO) and Recovery Time Objective (RTO)

Stated honestly for the deployment model this project actually ships (a single local/self-hosted Postgres container with no offsite replication or managed backup service):

- **RPO — how much data could be lost in an incident**: exactly the time since the last backup was taken. `backup-db.sh` performs a *manual, on-demand* logical dump; there is no automated backup schedule wired up in this deployment (no cron, no managed-database point-in-time-recovery). **This is a real, current limitation, not glossed over**: an operator running this locally/self-hosted must run `backup-db.sh` on a cadence appropriate to how much data loss is tolerable (e.g. via a host `cron` entry calling the script), or point `DATABASE_URL` at a managed Postgres provider that offers continuous point-in-time recovery instead of relying on this script alone for a real production deployment.
- **RTO — how long a restore takes**: dominated by `pg_dump`/`pg_restore` throughput against the actual database size; for the data volumes this project's own demo/test data produces (well under 100MB), a full restore completes in well under a minute, as observed during the verification above. This scales with data size — an operator with a much larger production dataset should measure their own restore time on a periodic basis rather than assuming it stays constant.

## Disaster recovery procedure

1. Stop the `api` container to prevent further writes during recovery: `docker compose stop api`.
2. If the target is the live database, take one last backup of its current (possibly corrupted) state first, in case any of it is still needed: `bash scripts/backup-db.sh`.
3. Restore the last known-good backup over the live database: `RESTORE_TARGET_DB=devforge BACKUP_FILE=<path> bash scripts/restore-db.sh`.
4. Restart `api`: `docker compose start api`, then confirm `GET /ready` returns `200`.
5. Confirm data integrity with a spot check appropriate to what changed (row counts, a specific record you know should exist).
