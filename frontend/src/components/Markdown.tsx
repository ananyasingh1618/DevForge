import { Fragment } from "react";
import { IconCopy } from "./icons.js";

/**
 * A small, dependency-free markdown-ish renderer for AI-generated answer
 * text (Q&A answers, review summaries/findings). Deliberately not a full
 * CommonMark implementation — it handles exactly what this app's own
 * responses actually produce (paragraphs, fenced code blocks, inline
 * code, bold text, and simple "- " / "1. " lists), which is enough to
 * render real answers well without adding a markdown-parser dependency.
 */

const TOKEN_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: "comment", re: /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/ },
  { type: "string", re: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/ },
  {
    type: "keyword",
    re: /\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|class|extends|new|try|catch|finally|throw|typeof|interface|type|def|self|None|True|False|elif|pass|yield|switch|case|break|continue|public|private|static|void|null|undefined)\b/,
  },
  { type: "number", re: /\b\d+(\.\d+)?\b/ },
];

const combinedTokenRe = new RegExp(TOKEN_PATTERNS.map((p) => p.re.source).join("|"), "g");

/** Tags each matched span with its token type via a lightweight scan —
 * intentionally approximate (no real language grammar), just enough to
 * make a code block visually scannable rather than a flat gray block. */
function highlightCode(code: string): { text: string; type: string | null }[] {
  const parts: { text: string; type: string | null }[] = [];
  let lastIndex = 0;
  for (const match of code.matchAll(combinedTokenRe)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: code.slice(lastIndex, index), type: null });
    }
    const value = match[0];
    const type =
      TOKEN_PATTERNS.find((p) => new RegExp(`^(?:${p.re.source})$`).test(value))?.type ?? null;
    parts.push({ text: value, type });
    lastIndex = index + value.length;
  }
  if (lastIndex < code.length) {
    parts.push({ text: code.slice(lastIndex), type: null });
  }
  return parts;
}

const tokenColor: Record<string, string> = {
  comment: "text-text-faint italic",
  string: "text-success",
  keyword: "text-accent",
  number: "text-warning",
};

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const parts = highlightCode(code);
  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-border bg-[#0a0a0e]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-faint">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(code)}
          className="flex items-center gap-1 text-[11px] text-text-faint hover:text-text-muted"
        >
          <IconCopy className="h-3 w-3" />
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 text-[13px] leading-relaxed">
        <code className="font-mono">
          {parts.map((part, i) => (
            <span key={i} className={part.type ? tokenColor[part.type] : undefined}>
              {part.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function renderInline(text: string, keyPrefix: string) {
  // Splits on **bold** and `inline code` without a full parser — a fixed
  // two-pattern pass is enough for this app's own real answer text.
  const segments = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((s) => s.length > 0);
  return segments.map((segment, i) => {
    const key = `${keyPrefix}-${i}`;
    if (segment.startsWith("**") && segment.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-text">
          {segment.slice(2, -2)}
        </strong>
      );
    }
    if (segment.startsWith("`") && segment.endsWith("`") && segment.length > 1) {
      return (
        <code key={key} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[0.85em] text-accent">
          {segment.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{segment}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactBlock[] = [];
  const lines = text.split("\n");
  let i = 0;
  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      blocks.push({ kind: "p", text: paragraphBuffer.join(" ") });
      paragraphBuffer = [];
    }
  }
  function flushList() {
    if (listBuffer.length > 0) {
      blocks.push({ kind: "list", items: [...listBuffer] });
      listBuffer = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fenceMatch = /^```(\w*)\s*$/.exec(line);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      const lang = fenceMatch[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      blocks.push({ kind: "code", code: codeLines.join("\n"), lang });
      i++;
      continue;
    }
    const listMatch = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      listBuffer.push(listMatch[1] ?? "");
      i++;
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphBuffer.push(line.trim());
    }
    i++;
  }
  flushParagraph();
  flushList();

  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-text">
      {blocks.map((block, idx) => {
        if (block.kind === "code") {
          return <CodeBlock key={idx} code={block.code} lang={block.lang} />;
        }
        if (block.kind === "list") {
          return (
            <ul key={idx} className="ml-4 list-disc space-y-1">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInline(item, `${idx}-${itemIdx}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx} className="whitespace-pre-wrap">
            {renderInline(block.text, String(idx))}
          </p>
        );
      })}
    </div>
  );
}

type ReactBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; code: string; lang: string };
