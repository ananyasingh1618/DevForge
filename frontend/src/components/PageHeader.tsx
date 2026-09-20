import type { ReactNode } from "react";

/** The large editorial page heading used at the top of every workspace
 * page — name, a one-line description, and an optional actions row, kept
 * as one component so heading scale/spacing stays consistent everywhere
 * instead of being hand-tuned per page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-faint">{eyebrow}</p>
        )}
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-text">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
