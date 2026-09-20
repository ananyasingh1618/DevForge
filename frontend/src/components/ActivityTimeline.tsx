import { motion } from "motion/react";
import type { IconProps } from "./icons.js";

export type TimelineTone = "neutral" | "accent" | "success" | "danger";

export type TimelineEvent = {
  id: string;
  label: string;
  detail?: string;
  timestamp: string;
  tone: TimelineTone;
  icon: (props: IconProps) => React.ReactNode;
};

const toneIcon: Record<TimelineTone, string> = {
  neutral: "text-text-muted bg-surface-3",
  accent: "text-accent bg-accent-soft",
  success: "text-success bg-success-soft",
  danger: "text-danger bg-danger-soft",
};

/** A real-events-only activity feed — requirements analyses, repository
 * connections, indexing runs, Q&A and review jobs, failures and retries.
 * Purely presentational: the caller builds `events` from its own already-
 * fetched API data, this component only lays them out in order. */
export function ActivityTimeline({
  events,
  emptyMessage,
}: {
  events: TimelineEvent[];
  emptyMessage: string;
}) {
  const sorted = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (sorted.length === 0) {
    return <p className="text-sm text-text-muted">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col">
      {sorted.map((event, i) => {
        const Icon = event.icon;
        return (
          <motion.li
            key={event.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: Math.min(i, 8) * 0.03 }}
            className="relative flex gap-3 pb-5 last:pb-0"
          >
            {i < sorted.length - 1 && (
              <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-border" />
            )}
            <span className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${toneIcon[event.tone]}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm text-text">{event.label}</p>
                <time className="shrink-0 font-mono text-[11px] text-text-faint">
                  {new Date(event.timestamp).toLocaleString()}
                </time>
              </div>
              {event.detail && <p className="mt-0.5 text-xs text-text-muted">{event.detail}</p>}
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}
