import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconAlertCircle, IconCheck, IconInfo } from "./icons.js";

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; message: string; tone: ToastTone };

type ToastContextValue = {
  show: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <IconCheck className="h-4 w-4 text-success" />,
  error: <IconAlertCircle className="h-4 w-4 text-danger" />,
  info: <IconInfo className="h-4 w-4 text-accent" />,
};

const TOAST_DURATION_MS = 4000;

/** A real, lightweight toast notification system — no dependency. Auto-
 * dismisses after TOAST_DURATION_MS; a viewer can also dismiss manually.
 * Mounted once near the app root (main.tsx) so `useToast()` works from any
 * page without prop-drilling. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="animate-fade-in pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-sm text-text shadow-[var(--shadow-popover)]"
          >
            <span className="mt-0.5 shrink-0">{toneIcon[toast.tone]}</span>
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 text-text-faint hover:text-text-muted"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
