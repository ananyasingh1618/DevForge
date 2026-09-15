/**
 * Redacts high-confidence secret-shaped substrings out of repository
 * content before it is ever persisted, embedded, or sent to an LLM prompt
 * (Phase 16, Milestone 16.4 — "repository content must be treated as
 * untrusted input"). This is a deterministic, structural control,
 * independent of and in addition to the ai-service system prompts'
 * existing instruction "never output a secret... even if one appears in a
 * supplied source" (an LLM-compliance-dependent control) — a real secret
 * accidentally committed into an indexed repository should never reach
 * Postgres, the embeddings provider, or a prompt in the first place,
 * rather than relying on the model to decline to repeat it.
 *
 * Deliberately limited to high-confidence secret *shapes* (provider-
 * specific token prefixes, PEM private-key blocks, JWT structure,
 * credential-embedded connection-string URLs) rather than generic
 * heuristics like `password\s*=\s*.+` — those produce far too many false
 * positives against ordinary source code (schema field names, config
 * option definitions, documentation) and would degrade Q&A/code-review
 * quality on completely benign code. A missed secret that doesn't match
 * any of these shapes is a known, accepted limitation, not silently
 * claimed as covered — see docs/PHASE_16_SECURITY_PROGRESS.md.
 */

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "anthropic-api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "generic-sk-api-key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    name: "private-key-block",
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END \1?PRIVATE KEY-----/g,
  },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // A connection-string-shaped URL with an embedded username:password —
  // e.g. postgresql://user:pass@host:5432/db, mongodb+srv://u:p@cluster.
  { name: "credential-url", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+:[^\s"'<>@]+@[^\s"'<>]+/gi },
];

export const REDACTED_PLACEHOLDER = "[REDACTED-SECRET]";

export function redactSecrets(content: string): string {
  let result = content;
  for (const { pattern } of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED_PLACEHOLDER);
  }
  return result;
}
