FROM python:3.12-slim

# Non-root runtime (Phase 17, Milestone 17.2) — python:3.12-slim has no
# built-in unprivileged user (unlike node:20-slim's `node`), so one is
# created explicitly. A fixed uid/gid (1000) keeps this reproducible and
# matches the convention node:20-slim itself uses for its own `node` user.
RUN groupadd --gid 1000 aiservice \
    && useradd --uid 1000 --gid aiservice --shell /bin/bash --create-home aiservice

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chown -R aiservice:aiservice /app
USER aiservice

EXPOSE 8001

# Reuses the exact same check docker-compose.yml's own healthcheck already
# runs, so this image is self-describing under `docker run` directly too.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD ["python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8001/health').status==200 else 1)"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
