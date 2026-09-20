import { useState } from "react";
import { Badge } from "./Badge.js";
import { IconChevronDown, IconCopy } from "./icons.js";
import type { RequirementItem } from "../types/requirements.js";

const priorityTone: Record<RequirementItem["priority"], "danger" | "warning" | "neutral"> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};

async function copyText(text: string) {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Clipboard access can be denied by the browser; the copy button simply
    // has no visible effect in that case rather than throwing.
  }
}

/** One numbered, expandable requirement — used for both functional and
 * non-functional requirements so a "beautiful document" replaces a flat
 * dump of raw JSON, while still surfacing every real field (priority,
 * source, acceptance criteria) the backend returns. */
export function RequirementAccordion({ item, index }: { item: RequirementItem; index: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const text = [
      `${item.id}: ${item.title}`,
      item.description,
      item.acceptanceCriteria.length > 0 ? `Acceptance criteria:\n${item.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    void copyText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2/50">
      <div className="flex items-start gap-1 pr-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-3 p-3.5 text-left transition-colors hover:bg-surface-2"
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-[10px] font-medium text-text-muted">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text">
                {item.id}: {item.title}
              </span>
              <Badge tone={priorityTone[item.priority]}>{item.priority}</Badge>
              <Badge>{item.source}</Badge>
            </div>
            {!open && <p className="mt-1 truncate text-xs text-text-muted">{item.description}</p>}
          </div>
          <IconChevronDown className={`mt-1 h-4 w-4 shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy requirement"
          className="mt-3.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface-3 hover:text-text"
        >
          <IconCopy className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="border-t border-border px-3.5 py-3">
          <p className="text-sm text-text-muted">{item.description}</p>
          {item.acceptanceCriteria.length > 0 && (
            <div className="mt-2.5">
              <p className="text-xs font-medium text-text-muted">Acceptance criteria</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-text-muted">
                {item.acceptanceCriteria.map((criterion, i) => (
                  <li key={i}>{criterion}</li>
                ))}
              </ul>
            </div>
          )}
          {copied && <p className="mt-2 text-[11px] text-success">Copied to clipboard</p>}
        </div>
      )}
    </div>
  );
}
