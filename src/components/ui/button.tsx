"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-cyan text-surface font-mono border border-cyan hover:bg-cyan/90 active:bg-cyan/80",
  secondary:
    "bg-surface-raised text-text font-mono border border-border hover:bg-surface-overlay active:bg-surface-raised",
  ghost:
    "bg-transparent text-text-dim font-mono hover:text-text hover:bg-surface-raised",
  danger:
    "bg-red/10 text-red font-mono border border-red/30 hover:bg-red/20",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-sm transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none",
          "uppercase tracking-wider",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
