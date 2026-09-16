# Production Smoke Testing

A short, fast checklist to run after any deploy, rebuild, or rollback — confirming the stack is not just "up" but actually serving correctly. This is the same sequence CI's `docker` job runs automatically on every push (see [CI_CD.md](CI_CD.md#jobs)); run it manually any time you want the same confidence locally.

```bash
# 1. All four services report healthy
docker compose ps
# every row's Health column should read "healthy"

# 2. Liveness and readiness
curl -sf http://localhost:4000/health | grep -q '"status":"ok"' && echo "liveness OK"
curl -sf http://localhost:4000/ready  | grep -q '"status":"ready"' && echo "readiness OK"

# 3. Metrics are real and populated
curl -sf http://localhost:4000/metrics | grep -q devforge_http_requests_total && echo "metrics OK"

# 4. ai-service is reachable
curl -sf http://localhost:8001/health | grep -q '"status"' && echo "ai-service OK"

# 5. Frontend serves real HTML
curl -sf http://localhost:4173 | grep -qi "<html" && echo "frontend OK"

# 6. A real register -> session cookie -> authenticated route round trip
COOKIE_JAR=$(mktemp)
code=$(curl -s -c "$COOKIE_JAR" -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke-test@example.com","password":"a-real-password-123","name":"Smoke Test"}' \
  -o /dev/null -w '%{http_code}')
[ "$code" = "201" ] && echo "register OK"
curl -sf -b "$COOKIE_JAR" http://localhost:4000/auth/me | grep -q "smoke-test@example.com" && echo "session OK"

# 7. Unauthenticated access to a protected route is rejected (isolation smoke check)
code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/projects)
[ "$code" = "401" ] && echo "isolation OK"

# 8. Containers run as their intended non-root user
[ "$(docker compose exec -T api whoami)" = "node" ] && echo "api nonroot OK"
[ "$(docker compose exec -T frontend whoami)" = "node" ] && echo "frontend nonroot OK"
[ "$(docker compose exec -T ai-service whoami)" = "aiservice" ] && echo "ai-service nonroot OK"
```

If step 6's test user needs cleaning up afterward: `docker compose exec postgres psql -U devforge -d devforge -c "DELETE FROM users WHERE email = 'smoke-test@example.com';"` (cascades to any owned projects/jobs).

All eight checks above were run against the real stack during Phase 17 development (not just written and assumed to pass) — see [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md#known-failure-modes-and-verified-behavior) for the failure-mode verifications that accompanied them.

## What "passing" means

Every command above either prints its own `... OK` line or produces no output — a missing `OK` line, a non-`healthy` row in step 1, or any command exiting non-zero means the deploy is not smoke-clean and should not be considered complete. Treat a smoke-test failure the same as any other incident (see [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)).
