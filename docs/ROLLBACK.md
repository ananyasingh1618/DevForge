# Rollback

## Application rollback

This deployment's images are built directly from the git working tree (`docker-compose.yml`'s `build: context: .`), so rolling back the application is rolling back the source and rebuilding:

```bash
git log --oneline -10          # find the last known-good commit
git checkout <known-good-commit>
docker compose build
docker compose up -d
docker compose ps               # confirm all four services return to healthy
curl -s http://localhost:4000/ready   # confirm readiness
```

If the bad deploy is already the tip of `main` and hasn't been pushed anywhere else, `git revert <bad-commit>` (creating a new commit that undoes it) is preferable to a hard reset — it preserves history and doesn't require force-pushing or discarding anyone else's work. Then rebuild as above.

## Database migration rollback

Prisma's `migrate deploy` (used by this project — see [DEPLOYMENT.md](DEPLOYMENT.md#database-migrations)) is forward-only by design; there is no `migrate down`. Rolling back a schema change means either:

1. **Writing a new forward migration** that undoes the change (the safe, standard approach — e.g. a migration that re-adds a dropped column). This keeps the migration history linear and truthful about what actually happened to the schema over time.
2. **Restoring from a pre-migration backup** ([BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)) when the migration already ran against real data and a forward-fix isn't viable (e.g. it destructively dropped a column and the data is gone). This is why `bash scripts/backup-db.sh` before running a new migration against a database with real data is the standing recommendation.

Never hand-edit `api/prisma/migrations/` history or the `_prisma_migrations` table directly outside of an actual incident — Prisma tracks applied migrations by checksum, and an inconsistency there can make `migrate deploy` refuse to run on the next legitimate deploy.

## Verifying a rollback succeeded

Run the same checks as [PRODUCTION_SMOKE_TESTING.md](PRODUCTION_SMOKE_TESTING.md) after any rollback — a rollback that leaves the stack unhealthy or fails the smoke checks is not a successful rollback, and should itself be treated as a new incident.
