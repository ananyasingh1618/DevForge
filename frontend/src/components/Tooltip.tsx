import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/** A small, accessible hover/focus tooltip — shows `label` (and an
 * optional keyboard-shortcut hint) near the trigger after a short delay,
 * and is wired via aria-describedby rather than a title attribute so it
 * reads sensibly to assistive tech. */
export function Tooltip({
  label,
  shortcut,
  children,
  side = "bottom",
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: "top" | "bottom" | "right";
}) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  function show() {
    timer.current = setTimeout(() => setVisible(true), 350);
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }

  const sideClass =
    side === "top"
      ? "bottom-full left-1/2 mb-2 -translate-x-1/2"
      : side === "right"
        ? "left-full top-1/2 ml-2 -translate-y-1/2"
        : "top-full left-1/2 mt-2 -translate-x-1/2";

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          id={id}
          className={`animate-fade-in pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface-3 px-2 py-1 text-[11px] font-medium text-text shadow-[var(--shadow-popover)] ${sideClass}`}
        >
          {label}
          {shortcut && (
            <kbd className="rounded border border-border-strong bg-surface px-1 py-0.5 font-mono text-[10px] text-text-muted">
              {shortcut}
            </kbd>
          )}
        </span>
      )}
    </span>
  );
}
