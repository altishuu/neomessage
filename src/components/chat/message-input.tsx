"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MessageInputProps {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageInput({
  onSend,
  disabled = false,
  placeholder = "Type a message...",
}: MessageInputProps) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || sending || disabled) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setContent("");
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch {
      // Error handled by parent
    } finally {
      setSending(false);
    }
  }, [content, sending, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  };

  return (
    <div className="flex items-end gap-2 px-4 py-3 border-t border-border bg-surface">
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder}
          rows={1}
          disabled={disabled || sending}
          className={cn(
            "w-full bg-surface-raised border border-border rounded-sm px-3 py-2.5 pr-10",
            "font-mono text-sm text-text placeholder:text-text-muted resize-none",
            "focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/30",
            "transition-colors duration-150",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "min-h-[38px] max-h-[160px]"
          )}
        />
      </div>
      <Button
        variant="primary"
        size="md"
        onClick={handleSend}
        disabled={!content.trim() || sending || disabled}
        className="flex-shrink-0"
      >
        {sending ? "..." : "Send"}
      </Button>
    </div>
  );
}
