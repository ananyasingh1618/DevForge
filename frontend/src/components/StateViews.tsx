import type { ReactNode } from "react";
import { Button } from "./Button.js";
import { IconAlertCircle, IconLoader } from "./icons.js";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-text-muted" role="status">
      <IconLoader className="h-5 w-5 animate-spin text-accent" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      {icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text-muted">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-text">{title}</p>
      {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft py-12 text-center"
      role="alert"
    >
      <IconAlertCircle className="h-5 w-5 text-danger" />
      <p className="text-sm font-medium text-danger">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
