#!/usr/bin/env python3
"""DevForge smoke + exposure test. Standard library only.

    python3 scripts/smoke_test.py http://127.0.0.1:8090
    python3 scripts/smoke_test.py https://<name>.trycloudflare.com

Runs the same checks against any base URL: the app works (SPA, deep links,
register/login/projects, cross-user isolation) AND internal/admin surface is
not reachable through the public entrypoint. It registers two throwaway
users (smoke+...@example.com) — the only 2 rate-limited auth calls per run.

It never prints secret values. If a local .env.production exists, its secret
values are used only to verify they do not appear in any HTTP response.
"""
import http.client
import json
import re
import ssl
import statistics
import sys
import time
import urllib.parse
import uuid
from pathlib import Path

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090").rstrip("/")
PARSED = urllib.parse.urlparse(BASE)
FAILED: list[str] = []


def _tls_context():
    """Verified TLS. python.org's macOS Python ships without CA roots, so fall
    back to the system bundle instead of ever disabling verification."""
    for cafile in ("/etc/ssl/cert.pem", "/opt/homebrew/etc/ca-certificates/cert.pem"):
        if Path(cafile).exists():
            return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


TLS = _tls_context()
BODIES: list[bytes] = []  # every response body, scanned for secrets at the end


def request(method, path, body=None, headers=None, cookies=None, raw_path=False):
    """One HTTP request, no redirects. Returns (status, headers dict, body bytes)."""
    if PARSED.scheme == "https":
        conn = http.client.HTTPSConnection(PARSED.hostname, PARSED.port, timeout=30, context=TLS)
    else:
        conn = http.client.HTTPConnection(PARSED.hostname, PARSED.port, timeout=30)
    hdrs = {"User-Agent": "devforge-smoke/1", **(headers or {})}
    if cookies:
        hdrs["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        hdrs.setdefault("Content-Type", "application/json")
    conn.request(method, path, body=data, headers=hdrs)
    resp = conn.getresponse()
    payload = resp.read()
    BODIES.append(payload)
    out_headers = {k.lower(): v for k, v in resp.getheaders()}
    out_headers["_set_cookie"] = "; ".join(v for k, v in resp.getheaders() if k.lower() == "set-cookie")
    conn.close()
    return resp.status, out_headers, payload


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        FAILED.append(name)


def session_cookie(set_cookie_header):
    m = re.search(r"devforge_session=([^;]+)", set_cookie_header)
    return {"devforge_session": m.group(1)} if m else {}


print(f"Target: {BASE}\n")

# --- entrypoint & static app -------------------------------------------------
s, h, b = request("GET", "/healthz")
check("GET /healthz -> 200 ok", s == 200 and b.strip() == b"ok")

s, h, index = request("GET", "/")
html = index.decode("utf-8", "replace")
check("GET / serves the SPA shell", s == 200 and '<div id="root">' in html)
check("SPA has CSP, nosniff, frame-deny headers",
      "content-security-policy" in h and h.get("x-content-type-options") == "nosniff" and h.get("x-frame-options") == "DENY")
# Locally there is no Server header at all; through the tunnel Cloudflare's own
# edge adds "Server: cloudflare" — nothing of ours (Caddy/Express/versions).
check("no X-Powered-By / server-software disclosure", "x-powered-by" not in h and h.get("server", "cloudflare").lower() == "cloudflare")

pid = str(uuid.uuid4())
for route in ["/login", "/register", "/projects", f"/projects/{pid}", f"/projects/{pid}/jobs",
              f"/projects/{pid}/qa", f"/projects/{pid}/reviews", f"/projects/{pid}/requirements"]:
    s, _, b = request("GET", route)
    check(f"deep link {route.replace(pid, ':id')} -> SPA (refresh works)", s == 200 and b'<div id="root">' in b)

assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
js = next((a for a in assets if a.endswith(".js")), None)
check("bundle references a hashed JS asset", js is not None)
if js:
    s, h, bundle = request("GET", js)
    check("JS asset served (200, javascript, immutable cache)",
          s == 200 and "javascript" in h.get("content-type", "") and "immutable" in h.get("cache-control", ""))
    check("bundle has no localhost/127.0.0.1 API URL baked in",
          b"localhost:4000" not in bundle and b"127.0.0.1:4000" not in bundle)
    s, _, b = request("GET", js + ".map")
    check("source map not served (404)", s == 404)
for path in ["/.env", "/.git/config", "/nonexistent.js", "/package.json", "/docker-compose.yml"]:
    s, _, b = request("GET", path)
    check(f"GET {path} -> 404, no file content", s == 404 and b"POSTGRES" not in b and b"SESSION_SECRET" not in b)

# --- API reachable through the proxy, internal surface not ---------------------
s, h, b = request("GET", "/api/health")
check("GET /api/health -> 200 {status: ok}", s == 200 and json.loads(b).get("data", {}).get("status") == "ok")

blocked = ["/api/metrics", "/api/metrics.json", "/api/ready", "/api/METRICS", "/api/metrics/", "/api/%6detrics",
           "/api//metrics", "/api/projects/../metrics", "/api/health/../metrics", "/api/docs", "/api/openapi.json",
           "/api/", "/api", "/api/unknown", "/api/_internal", "/api/jobs"]
for path in blocked:
    s, _, b = request("GET", path)
    leaked = b"devforge_" in b or b"http_requests" in b or b'"status":"ready"' in b or b"# HELP" in b
    check(f"blocked: GET {path}", s in (400, 401, 404) and not leaked, f"status={s}")
# Root-level API-looking paths must fall through to the SPA, never to the API.
for path in ["/metrics", "/ready", "/health", "/metrics.json"]:
    s, _, b = request("GET", path)
    check(f"root {path} is not the API", b"# HELP" not in b and b'"data"' not in b[:200], f"status={s}")
# ai-service, postgres etc. have no route at all through the proxy.
for path in ["/ai/health", "/api/ai-service/health", "/api/embeddings/generate", "/api/parse"]:
    s, _, b = request("GET", path)
    check(f"internal service path not proxied: {path}", s in (200, 404) and (b'<div id="root">' in b or s == 404) and b'"status":"ok"' not in b)

# --- authentication & authorization ---------------------------------------
s, _, _ = request("GET", "/api/projects")
check("unauthenticated /api/projects -> 401", s == 401)
s, _, _ = request("GET", "/api/auth/me")
check("unauthenticated /api/auth/me -> 401", s == 401)

email_a, email_b = (f"smoke+{uuid.uuid4().hex[:10]}@example.com" for _ in range(2))
password = uuid.uuid4().hex + "Aa1!"
s, h, b = request("POST", "/api/auth/register", {"email": email_a, "password": password})
cookie_a = session_cookie(h["_set_cookie"])
sc = h["_set_cookie"].lower()
check("register user A -> 201 + session cookie", s == 201 and bool(cookie_a), f"status={s}")
check("session cookie is HttpOnly, SameSite=Lax, Secure", "httponly" in sc and "samesite=lax" in sc and "secure" in sc)

s, _, b = request("GET", "/api/auth/me", cookies=cookie_a)
check("GET /api/auth/me with session -> 200 (own email)", s == 200 and email_a.encode() in b)
check("auth response never contains a password hash", b"passwordHash" not in b and b"$2b$" not in b)

s, _, b = request("POST", "/api/projects", {"name": "Smoke project", "description": "created by smoke_test.py"}, cookies=cookie_a)
project = json.loads(b).get("data", {}).get("project", {}) if s == 201 else {}
check("create project -> 201", s == 201 and "id" in project, f"status={s}")
s, _, b = request("GET", "/api/projects", cookies=cookie_a)
check("list projects includes it", s == 200 and project.get("id", "?").encode() in b)
s, _, b = request("GET", f"/api/projects/{project.get('id')}/jobs", cookies=cookie_a)
check("project jobs endpoint -> 200", s == 200)

s, h, b = request("POST", "/api/auth/register", {"email": email_b, "password": password})
cookie_b = session_cookie(h["_set_cookie"])
check("register user B -> 201", s == 201 and bool(cookie_b))
s, _, b = request("GET", f"/api/projects/{project.get('id')}", cookies=cookie_b)
check("user B cannot read user A's project (404, not 403/200)", s == 404, f"status={s}")
s, _, b = request("GET", f"/api/projects/{project.get('id')}/jobs", cookies=cookie_b)
check("user B cannot list user A's project jobs", s == 404, f"status={s}")
s, _, b = request("GET", "/api/projects", cookies=cookie_b)
check("user B's project list excludes A's", s == 200 and project.get("id", "?").encode() not in b)

s, _, _ = request("POST", "/api/auth/logout", cookies=cookie_a)
check("logout -> 204", s == 204, f"status={s}")
s, _, _ = request("GET", "/api/auth/me", cookies=cookie_a)
check("old session cookie rejected after logout (401)", s == 401)
s, _, _ = request("GET", "/api/auth/me", cookies={"devforge_session": "x" * 64})
check("forged session cookie rejected (401)", s == 401)

# --- CORS, limits ------------------------------------------------------------
evil = "https://evil.example"
s, h, _ = request("OPTIONS", "/api/auth/login", headers={"Origin": evil, "Access-Control-Request-Method": "POST",
                                                          "Access-Control-Request-Headers": "content-type"})
check("CORS preflight from foreign origin is not allowed", h.get("access-control-allow-origin") != evil)
s, h, _ = request("GET", "/api/projects", headers={"Origin": evil}, cookies=cookie_b)
check("foreign Origin never echoed with credentials", h.get("access-control-allow-origin") != evil)
s, _, _ = request("POST", "/api/auth/login", b"x" * (1_300_000), headers={"Content-Type": "application/json"})
check("oversized request body rejected (413)", s == 413, f"status={s}")

# --- latency -------------------------------------------------------------------
times = []
for _ in range(10):
    t = time.perf_counter()
    request("GET", "/api/health")
    times.append((time.perf_counter() - t) * 1000)
print(f"\nLatency GET /api/health x10: median {statistics.median(times):.0f} ms, max {max(times):.0f} ms")

# --- secret leakage across every response body seen ----------------------------
shapes = [rb"ghp_[A-Za-z0-9]{20,}", rb"sk-ant-[A-Za-z0-9_-]{20,}", rb"AIza[A-Za-z0-9_-]{30,}",
          rb"-----BEGIN [A-Z ]*PRIVATE KEY", rb"postgres(ql)?://[^\s\"']*:[^\s\"'@]+@", rb"SESSION_SECRET", rb"DATABASE_URL"]
leaks = [s.decode() for s in shapes if any(re.search(s, body) for body in BODIES)]
check("no secret-shaped strings in any HTTP response", not leaks, ", ".join(leaks))
env_file = Path(__file__).resolve().parent.parent / ".env.production"
if env_file.exists():
    values = [v.strip() for line in env_file.read_text().splitlines() if "=" in line and not line.startswith("#")
              for v in [line.split("=", 1)[1]] if len(v.strip()) >= 8 and not v.strip().isdigit()]
    found = sum(1 for v in values if any(v.encode() in body for body in BODIES))
    check(f"none of the {len(values)} secret values in .env.production appear in any response", found == 0)

print(f"\n{len(FAILED)} failed" if FAILED else "\nALL CHECKS PASSED")
sys.exit(1 if FAILED else 0)
