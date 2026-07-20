"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  duration?: number; // ms, default 3000
  onDismiss?: () => void;
}

/**
 * Auto-dismissing toast that slides in from the top.
 * Uses the terminal-cyber design tokens.
 */
export function Toast({
  message,
  type = "success",
  duration = 3000,
  onDismiss,
}: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    const enter = requestAnimationFrame(() => setVisible(true));

    const timer = setTimeout(() => {
      setVisible(false);
      // Wait for exit animation before calling onDismiss
      setTimeout(() => onDismiss?.(), 300);
    }, duration);

    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(timer);
    };
  }, [duration, onDismiss]);

  const accentClass =
    type === "success"
      ? "border-green/40 bg-green/10 text-green"
      : type === "error"
        ? "border-red/40 bg-red/10 text-red"
        : "border-cyan/40 bg-cyan/10 text-cyan";

  return (
    <div
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 z-[60]",
        "transition-all duration-300 ease-out",
        visible
          ? "translate-y-0 opacity-100"
          : "-translate-y-4 opacity-0 pointer-events-none",
      )}
    >
      <div
        className={cn(
          "px-4 py-2 rounded-sm border shadow-lg",
          "font-mono text-xs tracking-wide",
          accentClass,
        )}
      >
        ~$ {message}
      </div>
    </div>
  );
}
