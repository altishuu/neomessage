"use client";

import { useEffect, useRef } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";

interface MessageListProps {
  messages: Message[];
  loading?: boolean;
}

function MessageSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-2 animate-pulse">
      <div className="w-8 h-8 rounded-sm bg-surface-overlay flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-20 bg-surface-overlay rounded" />
        <div className="h-4 w-48 bg-surface-overlay rounded" />
      </div>
    </div>
  );
}

export function MessageList({ messages, loading }: MessageListProps) {
  const { user } = useAuth();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <MessageSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-text-dim text-sm">
            ~$ No messages yet
          </p>
          <p className="font-mono text-text-muted text-xs mt-1">
            Send a message to start the conversation
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-4 space-y-1">
      {messages.map((msg) => {
        const isMine = msg.senderId === user?.id;

        return (
          <div
            key={msg.id}
            className={cn(
              "flex items-start gap-3 px-4 py-2",
              isMine ? "flex-row-reverse" : "flex-row"
            )}
          >
            <div
              className={cn(
                "max-w-[70%] min-w-[100px] rounded-sm px-3 py-2",
                isMine
                  ? "bg-magenta/10 border border-magenta/30"
                  : "bg-surface-raised border border-border"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "font-mono text-[10px] font-semibold",
                    isMine ? "text-magenta" : "text-cyan"
                  )}
                >
                  {isMine ? "~$ you" : `~$ ${msg.sender.username}`}
                </span>
                <span className="font-mono text-[9px] text-text-muted">
                  {format(new Date(msg.createdAt), "HH:mm")}
                </span>
              </div>
              <p className="font-mono text-sm text-text leading-relaxed whitespace-pre-wrap break-words">
                {msg.content}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
