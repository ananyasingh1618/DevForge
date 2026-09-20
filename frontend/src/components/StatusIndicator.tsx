export type IndicatorTone = "neutral" | "accent" | "success" | "warning" | "danger";

const dotColor: Record<IndicatorTone, string> = {
  neutral: "bg-text-faint",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/** A compact dot + label used for at-a-glance system state (repository
 * connection, indexing, job activity) in the app shell's top bar and on
 * status-heavy pages — deliberately smaller and quieter than a full
 * Badge, since several of these sit side by side. */
export function StatusIndicator({
  tone,
  label,
  pulse = false,
  className = "",
}: {
  tone: IndicatorTone;
  label: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-text-muted ${className}`}>
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor[tone]} opacity-60`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotColor[tone]}`} />
      </span>
      {label}
    </span>
  );
}
