// Records the DevForge demo flow against a locally running stack using Playwright's built-in
// video recorder. It only drives the UI in a browser; it does not modify application code.
// Captions/timer are a browser-side overlay injected by this script (not part of the app).
// Usage: node record_demo.mjs <baseUrl> <outDir>   (needs `playwright` resolvable)
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = process.argv[2] ?? "http://127.0.0.1:8090";
const OUT = process.argv[3] ?? "./raw";
mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const EMAIL_A = `demo.maya.${stamp}@example.com`;
const EMAIL_B = `demo.visitor.${stamp}@example.com`;
const PASSWORD = randomBytes(12).toString("hex") + "Aa1!"; // throwaway; only ever typed into a masked field

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }, colorScheme: "dark",
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const t0 = Date.now();
const marks = [];
const mark = (name) => marks.push({ name, t: (Date.now() - t0) / 1000 });

await ctx.addInitScript(() => {
  const css = `
  #df-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1100px;z-index:2147483647;
    background:rgba(8,8,12,.92);color:#f2f2f5;font:500 22px/1.35 -apple-system,Segoe UI,sans-serif;padding:14px 26px;
    border-radius:12px;border:1px solid rgba(129,140,248,.55);text-align:center;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  #df-wait{position:fixed;right:24px;top:70px;z-index:2147483647;background:#3b2f0b;color:#fde68a;font:600 18px/1 ui-monospace,monospace;
    padding:10px 16px;border-radius:10px;border:1px solid #f59e0b;pointer-events:none}`;
  const init = () => {
    if (document.getElementById("df-cap")) return;
    const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
    const c = document.createElement("div"); c.id = "df-cap"; c.style.display = "none"; document.body.appendChild(c);
    const w = document.createElement("div"); w.id = "df-wait"; w.style.display = "none"; document.body.appendChild(w);
    const cap = sessionStorage.getItem("df_cap"); if (cap) { c.textContent = cap; c.style.display = "block"; }
    const ws = sessionStorage.getItem("df_wait");
    if (ws) startWait(w, Number(ws), sessionStorage.getItem("df_waitlabel") || "");
  };
  function startWait(w, since, label) {
    w.style.display = "block";
    const tick = () => { const s = Math.floor((Date.now() - since) / 1000);
      w.textContent = `${label} real time ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
    tick(); window.__waitTimer && clearInterval(window.__waitTimer); window.__waitTimer = setInterval(tick, 500);
  }
  window.__cap = (t) => { const c = document.getElementById("df-cap"); if (!c) return;
    if (t) { sessionStorage.setItem("df_cap", t); c.textContent = t; c.style.display = "block"; }
    else { sessionStorage.removeItem("df_cap"); c.style.display = "none"; } };
  window.__wait = (on, label) => { const w = document.getElementById("df-wait"); if (!w) return;
    if (on) { const since = Date.now(); sessionStorage.setItem("df_wait", String(since)); sessionStorage.setItem("df_waitlabel", label);
      startWait(w, since, label); }
    else { sessionStorage.removeItem("df_wait"); clearInterval(window.__waitTimer); w.style.display = "none"; } };
  document.addEventListener("DOMContentLoaded", init);
});

const page = await ctx.newPage();
const cap = (t) => page.evaluate((x) => window.__cap?.(x), t);
const hold = (ms) => page.waitForTimeout(ms);
async function aiStep(name, label, buttonRe) {
  const sec = name === "prd" ? "PRD" : name[0].toUpperCase() + name.slice(1);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await cap(`${label} — real AI request, not sped up here${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
    let btn = page.getByRole("button", { name: buttonRe }).first();
    // Downstream sections read their upstream dependency on page load, so refresh once if needed.
    if (!(await btn.isVisible().catch(() => false))) {
      await page.reload();
      await page.getByText(new RegExp(`^${sec}$`)).first().scrollIntoViewIfNeeded().catch(() => {});
      btn = page.getByRole("button", { name: buttonRe }).first();
      if (!(await btn.isVisible({ timeout: 8000 }).catch(() => false))) { console.log(`${name}: button unavailable`); mark(`${name}:unavailable`); return false; }
    }
    await page.evaluate((l) => window.__wait(true, l), "AI running:");
    mark(`${name}:wait_start`);
    const done = page.waitForResponse((r) => r.request().method() === "POST" && /\/(requirements\/analyze|prd\/generate|architecture\/generate|epics\/generate|tasks\/generate)$/.test(r.url()), { timeout: 300000 });
    await btn.click();
    const t = Date.now();
    const resp = await done;
    await hold(1500);
    mark(`${name}:wait_end`);
    await page.evaluate(() => window.__wait(false));
    console.log(`${name}: HTTP ${resp.status()} after ${((Date.now() - t) / 1000).toFixed(1)}s (attempt ${attempt})`);
    if (resp.ok()) return true;
    await cap("The AI provider returned an error — shown honestly; retrying"); await hold(3500);
  }
  return false;
}

// 1. entry -> register
await page.goto(BASE + "/login");
await cap("DevForge — AI-powered software engineering workspace"); mark("entry"); await hold(3500);
await page.getByRole("link", { name: /create|register|sign up/i }).first().click().catch(() => page.goto(BASE + "/register"));
await cap("Accounts use opaque server-side sessions; passwords are hashed with bcrypt");
await page.getByLabel("Email").fill(EMAIL_A);
await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
await hold(1800); mark("register");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/\/projects$/); await cap("Signed in — your projects, scoped to your account"); await hold(3000);

// 2. project
mark("project");
await page.goto(BASE + "/projects/new");
await cap("Create a project");
await page.getByLabel("Name").fill("Riverside Library Loans");
await hold(1200);
await page.getByRole("button", { name: "Create project" }).click();
await page.waitForURL(/\/projects\/(?!new$)[^/]+$/);
const pid = page.url().split("/").pop();
await cap("Project workspace — pipeline status in the top bar"); await hold(4000);

// 3. requirements -> PRD -> architecture -> epics -> tasks
await page.goto(`${BASE}/projects/${pid}/requirements`);
mark("requirements");
await cap("Step 1: describe an idea (fictional demo project)");
await page.getByLabel("Project idea").pressSequentially(
  "A web app for a small community library where members can reserve books, track loans and due dates, and librarians can manage the catalogue and overdue reminders.",
  { delay: 22 });
await hold(1200);
if (!(await aiStep("requirements", "Requirements analysis (Gemini)", /^analy[sz]e/i))) throw new Error("requirements failed");
await cap("Structured, versioned requirements — each tagged Stated or Inferred"); await hold(5500);
await page.getByText("FR-1").first().click().catch(() => {}); await hold(3500);
mark("requirements_shown");

await page.getByText(/^PRD$/).first().scrollIntoViewIfNeeded(); await hold(800);
const ok_prd = await aiStep("prd", "PRD generated from the active requirements version", /Generate PRD from Requirements/i);
await cap(ok_prd ? "PRD version created and made active" : "This stage did not complete against the AI provider in this recording — not shown as a success"); await hold(4000);
await page.getByText(/^Architecture$/).first().scrollIntoViewIfNeeded(); await hold(800);
const ok_architecture = await aiStep("architecture", "Architecture generated from the active PRD", /Generate architecture from PRD/i);
await cap(ok_architecture ? "Architecture version created from the active PRD" : "This stage did not complete against the AI provider in this recording — not shown as a success"); await hold(4000);
await page.getByText(/^Epics$/).first().scrollIntoViewIfNeeded(); await hold(800);
const ok_epics = await aiStep("epics", "Epics generated from the active architecture", /Generate epics/i);
await cap(ok_epics ? "Epics version created from the active architecture" : "This stage did not complete against the AI provider in this recording — not shown as a success"); await hold(4000);
await page.getByText(/^Tasks$/).first().scrollIntoViewIfNeeded(); await hold(800);
const ok_tasks = await aiStep("tasks", "Tasks generated from the active epics", /Generate tasks/i);
await cap(ok_tasks ? "Each stage builds on the previous active version" : "This stage did not complete against the AI provider in this recording — not shown as a success"); await hold(4500);
mark("chain_done");

// 4. repository / indexing / Q&A / review: honest states (no GitHub token used)
for (const [p, text] of [
  ["repository", "Repository connection: needs a user-supplied GitHub token — none is used in this demo"],
  ["indexing", "Indexing state for this project — no repository connected, so nothing is indexed"],
  ["qa", "Codebase Q&A requires a completed index; DevForge shows this instead of inventing answers"],
  ["reviews", "AI code review works the same way: no index, no fabricated review"],
]) { await page.goto(`${BASE}/projects/${pid}/${p}`); mark(p); await cap(text); await hold(5200); }

// 5. evaluations
await page.goto(`${BASE}/evaluations`); mark("evaluations");
await cap("Evaluation harness: a real run against the fixture benchmark (mock providers, offline)"); await hold(4500);
await page.getByText(/\d+\/\d+ cases/).first().click(); await hold(2500); await page.mouse.wheel(0, 450); await hold(3500);
await cap("Recall, MRR, citation validity and other gates — measured, not claimed"); await page.mouse.wheel(0, 700); await hold(5500);

// 6. jobs
await page.goto(`${BASE}/projects/${pid}/jobs`); mark("jobs");
await cap("Background jobs: durable Postgres-backed queue (indexing, Q&A, review)"); await hold(4500);

// 7. isolation
await page.goto(`${BASE}/projects`);
await ctx.clearCookies(); await page.goto(BASE + "/register"); mark("isolation");
await cap("Isolation: a second, unrelated account");
await page.getByLabel("Email").fill(EMAIL_B);
await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/\/projects$/); await cap("The second user sees none of the first user's projects"); await hold(4000);
await page.goto(`${BASE}/projects/${pid}`);
await cap("Opening the first user's project by its URL: not found (404, never 403)"); await hold(6000);
mark("end");
await cap(null);
await ctx.close(); await browser.close();
writeFileSync(`${OUT}/marks.json`, JSON.stringify({ marks, emails: [EMAIL_A, EMAIL_B] }, null, 1));
console.log("done", (Date.now() - t0) / 1000, "s");
