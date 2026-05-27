"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label
            htmlFor={id}
            className="font-mono text-xs uppercase tracking-wider text-text-dim"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            "w-full bg-surface-raised border border-border rounded-sm px-3 py-2.5",
            "font-mono text-sm text-text placeholder:text-text-muted",
            "focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/30",
            "transition-colors duration-150",
            error && "border-red focus:border-red focus:ring-red/30",
            className
          )}
          {...props}
        />
        {error && (
          <span className="font-mono text-xs text-red">{error}</span>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
