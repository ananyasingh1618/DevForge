import { motion } from "motion/react";
import { IconAlertCircle, IconCheck, IconClock, IconDatabase, IconLoader } from "./icons.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";

type StageState = "done" | "active" | "failed" | "pending";

function elapsed(startedAt: string | null, endAt: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = endAt ? new Date(endAt).getTime() : Date.now();
  const ms = end - start;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

const stageStyles: Record<StageState, { ring: string; bg: string; text: string }> = {
  done: { ring: "border-success/40", bg: "bg-success-soft", text: "text-success" },
  active: { ring: "border-accent/50", bg: "bg-accent-soft", text: "text-accent" },
  failed: { ring: "border-danger/40", bg: "bg-danger-soft", text: "text-danger" },
  pending: { ring: "border-border", bg: "bg-surface-2", text: "text-text-faint" },
};

function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <IconCheck className="h-4 w-4" />;
  if (state === "failed") return <IconAlertCircle className="h-4 w-4" />;
  if (state === "active") return <IconLoader className="h-4 w-4 animate-spin" />;
  return <IconClock className="h-4 w-4" />;
}

/**
 * A real-data-only stage tracker for an indexing run — queued, fetching &
 * parsing (with a genuine files-parsed/total progress bar), and the
 * terminal completed/failed state. There is no per-file "chunking" or
 * "embedding" stage exposed by the backend (those happen lazily on first
 * search, not during indexing) — showing one here would be fabricated
 * progress, so the tracker only ever reflects `CodebaseIndex` fields that
 * are actually returned by the API.
 */
export function IndexingProgress({ index }: { index: CodebaseIndex }) {
  const isTerminal = index.status === "completed" || index.status === "failed";
  const totalSeen = index.parsedFileCount + index.failedFileCount;
  const progressPct = index.fileCount > 0 ? Math.min(100, Math.round((totalSeen / index.fileCount) * 100)) : 0;

  const stages: { key: string; label: string; state: StageState; detail: string }[] = [
    {
      key: "queued",
      label: "Queued",
      state: "done",
      detail: new Date(index.createdAt).toLocaleString(),
    },
    {
      key: "parsing",
      label: "Fetching & parsing files",
      state: index.status === "indexing" ? "active" : isTerminal ? "done" : "pending",
      detail:
        index.fileCount > 0
          ? `${totalSeen}/${index.fileCount} files seen`
          : index.status === "indexing"
            ? "In progress…"
            : "Not started",
    },
    {
      key: "terminal",
      label: index.status === "failed" ? "Failed" : "Completed",
      state: index.status === "failed" ? "failed" : index.status === "completed" ? "done" : "pending",
      detail: index.completedAt
        ? new Date(index.completedAt).toLocaleString()
        : index.status === "indexing"
          ? `Elapsed ${elapsed(index.startedAt, null) ?? "—"}`
          : "Waiting",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-0">
        {stages.map((stage, i) => {
          const styles = stageStyles[stage.state];
          return (
            <div key={stage.key} className="flex flex-1 items-center">
              <div className="flex flex-1 flex-col items-center gap-2 text-center">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full border ${styles.ring} ${styles.bg} ${styles.text}`}>
                  <StageIcon state={stage.state} />
                </span>
                <div>
                  <p className="text-xs font-medium text-text">{stage.label}</p>
                  <p className="mt-0.5 max-w-[9rem] font-mono text-[10px] text-text-faint">{stage.detail}</p>
                </div>
              </div>
              {i < stages.length - 1 && (
                <div className="mb-8 h-px flex-1 bg-border" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {index.fileCount > 0 && !isTerminal && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Files parsed</span>
            <span className="font-mono">{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <IconDatabase className="h-3.5 w-3.5 text-text-faint" />
          {index.fileCount} files total
        </span>
        <span>{index.parsedFileCount} parsed</span>
        {index.failedFileCount > 0 && <span className="text-danger">{index.failedFileCount} failed</span>}
        {index.startedAt && (
          <span>Elapsed {elapsed(index.startedAt, index.completedAt) ?? "—"}</span>
        )}
      </div>
    </div>
  );
}
