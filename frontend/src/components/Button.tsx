import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium " +
  "transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 " +
  "active:scale-[0.98]";

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-sm",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-[0_1px_0_0_rgb(255_255_255_/_0.08)_inset] hover:bg-accent-hover",
  secondary: "border border-border-strong bg-surface-2 text-text hover:bg-surface-3",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-white hover:brightness-90",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
});
