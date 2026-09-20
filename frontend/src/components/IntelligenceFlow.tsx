import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { IconAlertCircle, IconCheck, IconLoader } from "./icons.js";
import type { IconProps } from "./icons.js";

export type FlowStageStatus = "not-configured" | "ready" | "running" | "completed" | "failed";

export type FlowStage = {
  key: string;
  label: string;
  caption: string;
  status: FlowStageStatus;
  to: string;
  icon: (props: IconProps) => React.ReactNode;
};

const statusStyles: Record<FlowStageStatus, { ring: string; dot: string; text: string }> = {
  "not-configured": { ring: "border-border", dot: "bg-text-faint", text: "text-text-faint" },
  ready: { ring: "border-border-strong", dot: "bg-text-muted", text: "text-text-muted" },
  running: { ring: "border-accent/50", dot: "bg-accent", text: "text-accent" },
  completed: { ring: "border-success/40", dot: "bg-success", text: "text-success" },
  failed: { ring: "border-danger/40", dot: "bg-danger", text: "text-danger" },
};

function StatusGlyph({ status }: { status: FlowStageStatus }) {
  if (status === "completed") return <IconCheck className="h-3 w-3" />;
  if (status === "failed") return <IconAlertCircle className="h-3 w-3" />;
  if (status === "running") return <IconLoader className="h-3 w-3 animate-spin" />;
  return null;
}

/**
 * The Overview page's project-intelligence pipeline — Idea → Requirements
 * → Repository → Indexing → Code Intelligence → Q&A/Review — rendered as
 * a connected flow of real, clickable stage status, not a chart. Every
 * status comes from the caller's real API data; this component only
 * lays it out.
 */
export function IntelligenceFlow({ stages }: { stages: FlowStage[] }) {
  return (
    <div className="flex flex-col gap-0 lg:flex-row lg:items-stretch lg:gap-0">
      {stages.map((stage, i) => {
        const styles = statusStyles[stage.status];
        const Icon = stage.icon;
        return (
          <motion.div
            key={stage.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.05 }}
            className="relative flex flex-1 items-stretch"
          >
            <Link
              to={stage.to}
              className="group flex flex-1 flex-col gap-2 border-b border-border p-4 transition-colors hover:bg-surface-2 lg:border-b-0 lg:border-r lg:last:border-r-0"
            >
              <div className="flex items-center justify-between">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${styles.ring} bg-surface-2 ${styles.text}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide ${styles.text}`}>
                  <StatusGlyph status={stage.status} />
                  <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-text">{stage.label}</p>
                <p className="mt-0.5 text-xs text-text-muted">{stage.caption}</p>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
