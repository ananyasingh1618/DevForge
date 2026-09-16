/**
 * A minimal structured logger (Phase 17, Milestone 17.5 —
 * docs/OPERATIONS.md's "Logs" section). Extends this project's own
 * established pattern (see auditLog.ts / searchObservability.ts — one JSON
 * line per event, to stdout, no new infrastructure) into a general-purpose
 * logger every request/job/error path can share, rather than each call
 * site hand-rolling its own `console.log(JSON.stringify(...))`.
 *
 * Deliberately still just stdout — this project's whole logging strategy
 * (audit events, search observability, now general request/job logs) has
 * always been "structured JSON lines a real log aggregator (CloudWatch,
 * Datadog, an ELK stack, `docker compose logs`) can already ingest without
 * a bespoke shipper," never a custom logging service. No fake "connected
 * to $VENDOR" claim is made anywhere in this codebase — there is no
 * external logging provider configured, and none is pretended to be.
 */

import { env } from "../env.js";
import { redactSecrets } from "./secretRedaction.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

const minLevel = LEVELS[env.LOG_LEVEL];

export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Redacts any string field value that matches a known secret shape
 * (`secretRedaction.ts`'s own patterns — API keys, tokens, credential
 * URLs, JWTs, private-key blocks) before a log line is ever written. A
 * log call site passing a value that happens to be secret-shaped (e.g.
 * echoing part of a malformed request body into an error field) is caught
 * here rather than relying on every call site to remember to redact it
 * itself. */
function redactFields(fields: LogFields): LogFields {
  const redacted: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = typeof value === "string" ? redactSecrets(value) : value;
  }
  return redacted;
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVELS[level] < minLevel) return;
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactFields(fields),
  };
  const target = level === "error" || level === "warn" ? console.error : console.log;
  target(JSON.stringify(line));
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};
