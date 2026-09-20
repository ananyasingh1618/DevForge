import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const toneStyles: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/** A small, consistent status pill — rounded but not a giant capsule, used
 * everywhere a job/index/finding/connection status needs a compact,
 * accessible-contrast label. */
export function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium capitalize ${toneStyles[tone]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
