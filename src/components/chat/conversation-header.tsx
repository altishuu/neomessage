"use client";

import type { User } from "@/lib/types";
import type { TypingUser } from "@/lib/hooks/use-typing-presence";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

interface ConversationHeaderProps {
  participants: User[];
  typingUsers?: TypingUser[];
}

export function ConversationHeader({
  participants,
  typingUsers = [],
}: ConversationHeaderProps) {
  const { user } = useAuth();
  const otherParticipants = participants.filter((p) => p.id !== user?.id);

  const name =
    otherParticipants.map((p) => p.username).join(", ") || "Unknown";

  // Only show typing indicator for other users
  const othersTyping = typingUsers.filter((tu) => tu.userId !== user?.id);
  const typingText = othersTyping.length === 1
    ? othersTyping[0].username
    : othersTyping.length > 1
    ? `several users`
    : "";


  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface-raised flex-shrink-0">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "w-2 h-2 rounded-full transition-colors duration-300",
            othersTyping.length > 0 ? "bg-cyan animate-pulse" : "bg-green"
          )}
        />
        <span className="font-mono text-sm font-semibold text-text">
          {name}
        </span>
      </div>

      {othersTyping.length > 0 ? (
        <span className="font-mono text-[10px] text-cyan animate-pulse ml-auto">
          ~$ {typingText} {othersTyping.length > 1 ? "are" : "is"} typing
          <span className="inline-flex ml-0.5">
            <span className="animate-typing-dot">.</span>
            <span className="animate-typing-dot animation-delay-200">.</span>
            <span className="animate-typing-dot animation-delay-400">.</span>
          </span>
        </span>
      ) : (
        <span className="font-mono text-[10px] text-text-muted ml-auto">
          online
        </span>
      )}
    </header>
  );
}
