/**
 * Real, in-process metrics (Phase 17, Milestone 17.5 —
 * docs/OPERATIONS.md's "Metrics" section). Every counter here is
 * incremented by an actual request or job event as it happens — nothing
 * here is a placeholder, a fabricated number, or a claim that an external
 * monitoring provider (Prometheus, Datadog, etc.) is configured. None is:
 * this process exposes its own numbers over `/metrics`, in the standard
 * Prometheus text exposition format, so a real Prometheus (or anything
 * that speaks that format) can scrape it if one is ever deployed
 * alongside this service — the format is chosen for that compatibility,
 * not because a scraper is actually running here.
 *
 * Deliberately in-memory, per-process, reset on restart: this matches the
 * project's own established "no new infrastructure" precedent
 * (auditLog.ts, searchObservability.ts) — a real production deployment
 * with multiple API replicas would aggregate these at the scrape layer
 * (which is exactly what Prometheus itself is designed to do), not by
 * this process trying to maintain global state itself.
 */

type Counter = Map<string, number>;

function inc(counter: Counter, key: string, by = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + by);
}

const requestsByRoute = new Map<string, number>();
const requestsByStatusClass = new Map<string, number>();
const requestLatenciesMs: number[] = [];
const MAX_LATENCY_SAMPLES = 2000; // bounded ring buffer — never an unbounded memory leak

const jobsByTypeAndOutcome = new Map<string, number>();

export function recordRequest(routeLabel: string, statusCode: number, latencyMs: number): void {
  inc(requestsByRoute, routeLabel);
  const statusClass = `${Math.floor(statusCode / 100)}xx`;
  inc(requestsByStatusClass, statusClass);
  requestLatenciesMs.push(latencyMs);
  if (requestLatenciesMs.length > MAX_LATENCY_SAMPLES) {
    requestLatenciesMs.splice(0, requestLatenciesMs.length - MAX_LATENCY_SAMPLES);
  }
}

export type JobOutcome = "completed" | "failed" | "retried" | "timed_out" | "cancelled";

export function recordJobOutcome(jobType: string, outcome: JobOutcome): void {
  inc(jobsByTypeAndOutcome, `${jobType}:${outcome}`);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/** A plain-JSON snapshot — used by the smoke tests and by `/metrics`'s own
 * human-readable companion, so the underlying numbers are also inspectable
 * without needing to parse Prometheus text format. */
export function metricsSnapshot() {
  const sortedLatencies = [...requestLatenciesMs].sort((a, b) => a - b);
  const totalRequests = [...requestsByStatusClass.values()].reduce((a, b) => a + b, 0);
  const errorRequests = (requestsByStatusClass.get("4xx") ?? 0) + (requestsByStatusClass.get("5xx") ?? 0);
  return {
    requests: {
      total: totalRequests,
      byStatusClass: Object.fromEntries(requestsByStatusClass),
      byRoute: Object.fromEntries(requestsByRoute),
      errorRate: totalRequests > 0 ? errorRequests / totalRequests : 0,
      latencyMsP50: percentile(sortedLatencies, 50),
      latencyMsP95: percentile(sortedLatencies, 95),
      latencyMsP99: percentile(sortedLatencies, 99),
    },
    jobs: Object.fromEntries(jobsByTypeAndOutcome),
  };
}

/** Prometheus text exposition format (https://prometheus.io/docs/instrumenting/exposition_formats/). */
export function metricsPrometheusText(): string {
  const lines: string[] = [];
  lines.push("# HELP devforge_http_requests_total Total HTTP requests handled, by route.");
  lines.push("# TYPE devforge_http_requests_total counter");
  for (const [route, count] of requestsByRoute) {
    lines.push(`devforge_http_requests_total{route="${route}"} ${count}`);
  }
  lines.push("# HELP devforge_http_responses_total Total HTTP responses, by status class.");
  lines.push("# TYPE devforge_http_responses_total counter");
  for (const [statusClass, count] of requestsByStatusClass) {
    lines.push(`devforge_http_responses_total{status_class="${statusClass}"} ${count}`);
  }
  const sortedLatencies = [...requestLatenciesMs].sort((a, b) => a - b);
  lines.push("# HELP devforge_http_request_latency_ms HTTP request latency percentiles, milliseconds.");
  lines.push("# TYPE devforge_http_request_latency_ms gauge");
  lines.push(`devforge_http_request_latency_ms{quantile="0.5"} ${percentile(sortedLatencies, 50)}`);
  lines.push(`devforge_http_request_latency_ms{quantile="0.95"} ${percentile(sortedLatencies, 95)}`);
  lines.push(`devforge_http_request_latency_ms{quantile="0.99"} ${percentile(sortedLatencies, 99)}`);
  lines.push("# HELP devforge_jobs_total Total background jobs, by type and outcome.");
  lines.push("# TYPE devforge_jobs_total counter");
  for (const [key, count] of jobsByTypeAndOutcome) {
    const [jobType, outcome] = key.split(":");
    lines.push(`devforge_jobs_total{type="${jobType}",outcome="${outcome}"} ${count}`);
  }
  return lines.join("\n") + "\n";
}

/** Test-only reset so metrics tests don't leak state across test files. */
export function __resetMetricsForTests(): void {
  requestsByRoute.clear();
  requestsByStatusClass.clear();
  requestLatenciesMs.length = 0;
  jobsByTypeAndOutcome.clear();
}
