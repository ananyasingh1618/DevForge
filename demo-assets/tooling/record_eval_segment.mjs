// Supplementary segment (evaluation page detail, no AI calls). Records the DevForge demo flow against a locally running stack using Playwright's built-in
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

await page.goto(BASE + "/register");
await page.getByLabel("Email").fill(EMAIL_A);
await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/\/projects$/);
await page.goto(`${BASE}/evaluations`); mark("evaluations");
await cap("Evaluation harness: a real run against the fixture benchmark (mock providers, offline)"); await hold(4500);
await page.getByText(/\d+\/\d+ cases/).first().click(); await hold(3000);
await page.mouse.wheel(0, 380); await hold(3500);
await cap("Recall, MRR, citation validity and other gates — measured, not claimed");
await page.mouse.wheel(0, 500); await hold(4500); await page.mouse.wheel(0, 600); await hold(4500);
mark("end"); await cap(null);
await ctx.close(); await browser.close();
writeFileSync(`${OUT}/marks.json`, JSON.stringify({ marks, emails: [EMAIL_A] }, null, 1));
console.log("done", (Date.now() - t0) / 1000);
