import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
};

export function Card({ className = "", interactive = false, ...props }: CardProps) {
  return (
    <div
      className={
        "rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] " +
        (interactive
          ? "transition-all duration-150 hover:border-border-strong hover:shadow-[var(--shadow-elevated)] "
          : "") +
        className
      }
      {...props}
    />
  );
}
