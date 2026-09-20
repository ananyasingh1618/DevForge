import { useState } from "react";
import { IconChevronDown, IconCopy, IconFileText } from "./icons.js";

export type EvidenceSource = {
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  score: number;
  cited?: boolean;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // No visible effect if the browser denies clipboard access.
  }
}

/**
 * A single evidence card for a Q&A or review source. The backend's
 * retrieval sources are metadata only (file path, symbol, line range,
 * relevance score) — it does not return the underlying code excerpt, so
 * this deliberately does not render a fabricated code block. What it does
 * show (path, lines, relevance, citation) is real and expands for a
 * closer look rather than a full code snippet that doesn't exist here.
 */
export function SourceEvidence({ source }: { source: EvidenceSource }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const reference = `${source.filePath}:${source.startLine}-${source.endLine}`;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    void copyText(reference).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2/50">
      <div className="flex items-center gap-1 pr-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
        >
          <IconFileText className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text">{source.filePath}</span>
          {source.symbolName && (
            <span className="shrink-0 truncate text-[11px] text-text-muted">{source.symbolName}</span>
          )}
          <span className="shrink-0 font-mono text-[11px] text-text-faint">
            L{source.startLine}–{source.endLine}
          </span>
          {source.cited && (
            <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
              cited
            </span>
          )}
          <IconChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy file reference"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface-3 hover:text-text"
        >
          <IconCopy className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Relevance</span>
              <span className="font-mono text-text">{(source.score * 100).toFixed(1)}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, Math.max(2, source.score * 100))}%` }}
              />
            </div>
          </div>
          {copied && <p className="text-[11px] text-success">Copied {reference}</p>}
        </div>
      )}
    </div>
  );
}
