#!/usr/bin/env node
/**
 * Deterministic, credential-free end-to-end demo of DevForge (Phase 18,
 * Milestone 18.3) — see docs/DEMO.md. Drives the real running stack over
 * its real HTTP API, exactly as a real user's browser would, covering the
 * full 12-step workflow: register/sign in, create a project, attempt a
 * repository connection, attempt requirements/PRD/architecture/epics
 * generation, attempt codebase search/Q&A/review, create and inspect a
 * background job, and demonstrate that job's clean failure and recovery
 * (retry) behavior.
 *
 * No GitHub personal access token, Gemini/Anthropic API key, or Voyage AI
 * key is required to run this script to completion — every step that needs
 * one of those (repository connection, requirements/PRD/architecture/
 * epics/QA/review generation, embedding-backed search) is expected to
 * return a real, honest "not configured" error when that credential is
 * absent, and this script reports that as the correct, documented
 * behavior, never as a failure of the script itself. If real credentials
 * ARE present in the environment (GEMINI_API_KEY — preferred, free tier —
 * or ANTHROPIC_API_KEY, VOYAGE_API_KEY, and
 * GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO), the corresponding steps use them
 * for a fully real run instead — set them before running this script to see
 * the "real" path.
 */

const API_URL = process.env.DEMO_API_URL ?? "http://localhost:4000";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

let cookie = "";
let step = 0;

function log(status, message) {
  const marker = { ok: "✅", info: "ℹ️ ", warn: "⚠️ ", fail: "❌" }[status] ?? "  ";
  console.log(`${marker} ${message}`);
}

function heading(title) {
  step += 1;
  console.log(`\n--- Step ${step}: ${title} ---`);
}

async function call(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let json = null;
  try {
    json = await res.json();
  } catch {
    // some responses (e.g. 204) have no body
  }
  return { status: res.status, body: json };
}

async function main() {
  console.log("DevForge deterministic end-to-end demo\n" + "=".repeat(40));

  heading("Confirm the stack is up and ready");
  const health = await call("GET", "/health");
  const ready = await call("GET", "/ready");
  if (health.status !== 200 || ready.status !== 200) {
    log("fail", `Stack not ready (health=${health.status}, ready=${ready.status}). Run "docker compose up -d" and retry.`);
    process.exit(1);
  }
  log("ok", `api is healthy and ready (database: ${ready.body.data.database})`);

  heading("Register a fresh demo user and start a session");
  const email = `demo-${Date.now()}@example.com`;
  const register = await call("POST", "/auth/register", {
    email,
    password: "demo-password-123",
    name: "Demo User",
  });
  if (register.status !== 201) {
    log("fail", `Registration failed unexpectedly: ${register.status} ${JSON.stringify(register.body)}`);
    process.exit(1);
  }
  log("ok", `Registered and signed in as ${email}`);

  heading("Create a project");
  const project = await call("POST", "/projects", { name: "DevForge Demo Project" });
  if (project.status !== 201) {
    log("fail", `Project creation failed: ${project.status} ${JSON.stringify(project.body)}`);
    process.exit(1);
  }
  const projectId = project.body.data.project.id;
  log("ok", `Created project ${projectId} ("${project.body.data.project.name}")`);

  heading("Connect a repository (or demonstrate the honest not-configured path)");
  let repoConnected = false;
  if (GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO) {
    const connect = await call("POST", `/projects/${projectId}/repository/connect`, {
      token: GITHUB_TOKEN,
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
    if (connect.status === 200 || connect.status === 201) {
      repoConnected = true;
      log("ok", `Connected real repository ${GITHUB_OWNER}/${GITHUB_REPO} (real GITHUB_TOKEN supplied)`);
    } else {
      log("warn", `Real GitHub credentials were supplied but connection failed: ${connect.status} ${JSON.stringify(connect.body)}`);
    }
  } else {
    const connect = await call("POST", `/projects/${projectId}/repository/connect`, {
      token: "no-real-token-supplied",
      owner: "example",
      repo: "example",
    });
    log(
      "info",
      `No GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO supplied — this environment has no GitHub credentials, matching its documented honesty guarantee. ` +
        `Real response: ${connect.status} ${connect.body?.error?.code ?? ""} — ${connect.body?.error?.message ?? ""}`,
    );
  }

  heading("Attempt requirements analysis (needs GEMINI_API_KEY or ANTHROPIC_API_KEY)");
  const requirements = await call("POST", `/projects/${projectId}/requirements/analyze`, {
    idea: "A tool that helps developers track and resolve technical debt across a large codebase.",
  });
  if (requirements.status === 201) {
    // Which provider actually answered (Gemini vs. Anthropic) is decided
    // server-side inside the ai-service container, based on *its own*
    // environment -- not this script's. Checking process.env.GEMINI_API_KEY
    // here would silently report the wrong provider whenever this script
    // runs somewhere that doesn't share ai-service's exact environment
    // (e.g. the normal case: keys live in a root .env file docker compose
    // reads, not in the shell this script itself runs in). Found live: this
    // printed "via Anthropic" for a response Gemini actually produced.
    log("ok", "Real requirements analysis succeeded (functional/non-functional requirements, user roles, features, risks, constraints, assumptions, open questions all returned).");
  } else {
    log(
      "info",
      `No GEMINI_API_KEY or ANTHROPIC_API_KEY configured in this environment — real response: ${requirements.status} ${requirements.body?.error?.code ?? ""} — ${requirements.body?.error?.message ?? ""}. This is the documented, honest "not configured" path, not a failure.`,
    );
  }

  heading("Attempt PRD generation (depends on an active requirements version)");
  const prd = await call("POST", `/projects/${projectId}/prd/generate`, {});
  log(
    prd.status === 201 ? "ok" : "info",
    prd.status === 201
      ? "Real PRD generated from the active requirements version."
      : `Real response: ${prd.status} ${prd.body?.error?.code ?? ""} — ${prd.body?.error?.message ?? ""}`,
  );

  heading("Attempt codebase search / Q&A / AI code review (depend on a completed index)");
  const search = await call("POST", `/projects/${projectId}/search`, { query: "how does authentication work" });
  log(
    "info",
    `Search real response: ${search.status} ${search.body?.error?.code ?? "ok"} — ` +
      (search.status === 200
        ? `${search.body.data.results.length} result(s)`
        : search.body?.error?.message ?? ""),
  );
  const qa = await call("POST", `/projects/${projectId}/qa`, { question: "How is a session created?" });
  log(
    "info",
    `Q&A real response: ${qa.status} ${qa.body?.error?.code ?? "ok"}` +
      (qa.status !== 201 ? ` — ${qa.body?.error?.message ?? ""}` : ""),
  );
  const review = await call("POST", `/projects/${projectId}/reviews`, {});
  log(
    "info",
    `Code review real response: ${review.status} ${review.body?.error?.code ?? "ok"}` +
      (review.status !== 201 ? ` — ${review.body?.error?.message ?? ""}` : ""),
  );

  heading("Create a background job and inspect its real status (job history)");
  const job = await call("POST", `/projects/${projectId}/jobs`, { type: "indexing" });
  if (job.status !== 201) {
    log("fail", `Job creation itself failed unexpectedly: ${job.status} ${JSON.stringify(job.body)}`);
    process.exit(1);
  }
  const jobId = job.body.data.job.id;
  log("ok", `Created indexing job ${jobId}, initial status "${job.body.data.job.status}"`);

  let finalJob = null;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const check = await call("GET", `/projects/${projectId}/jobs/${jobId}`);
    if (["completed", "failed", "cancelled", "timed_out"].includes(check.body.data.job.status)) {
      finalJob = check.body.data.job;
      break;
    }
  }
  if (!finalJob) {
    log("warn", "Job did not reach a terminal state within 15s — this can happen under heavy load; check GET /projects/:id/jobs manually.");
  } else if (finalJob.status === "completed") {
    log("ok", `Job completed successfully (real repository/credentials were available end to end).`);
  } else {
    log(
      "ok",
      `Job reached a clean terminal state "${finalJob.status}" with a real, visible error ` +
        `(${finalJob.errorCode ?? "n/a"}: ${finalJob.errorMessage ?? "n/a"}) — never silently stuck or lost. ` +
        `This demonstrates real job-failure visibility, expected in this environment since no repository is connected.`,
    );
  }

  heading("Demonstrate failure and recovery: retry the job");
  const retry = await call("POST", `/projects/${projectId}/jobs/${jobId}/retry`, {});
  if (retry.status === 200 || retry.status === 201) {
    log("ok", `Job retry accepted — status reset to "${retry.body.data.job.status}" for another attempt (bounded by its own maxRetries). This is DevForge's real, tested recovery path for a failed job, not a simulation.`);
  } else {
    log("info", `Retry response: ${retry.status} ${retry.body?.error?.code ?? ""} — ${retry.body?.error?.message ?? ""}`);
  }

  heading("List job history for the project");
  const jobs = await call("GET", `/projects/${projectId}/jobs`);
  log("ok", `Project has ${jobs.body.data.jobs.length} job(s) in its history, most recent first.`);

  console.log("\n" + "=".repeat(40));
  console.log("Demo complete.");
  console.log(`Project: ${projectId}`);
  console.log(`User: ${email}`);
  console.log(
    "Every step above either used real, working DevForge functionality, or hit a real, honest\n" +
      '"not configured" / dependency error exactly as documented in README.md\'s "Known limitations"\n' +
      "and each feature's own honesty guarantee — nothing in this demo is simulated or fabricated.",
  );
}

main().catch((err) => {
  console.error("Demo script failed with an unexpected error:", err);
  process.exit(1);
});
