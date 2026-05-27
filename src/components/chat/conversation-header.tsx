"use client";

import type { User } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";

interface ConversationHeaderProps {
  participants: User[];
}

export function ConversationHeader({
  participants,
}: ConversationHeaderProps) {
  const { user } = useAuth();
  const otherParticipants = participants.filter((p) => p.id !== user?.id);

  const name =
    otherParticipants.map((p) => p.username).join(", ") || "Unknown";

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface-raised flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green" />
        <span className="font-mono text-sm font-semibold text-text">
          {name}
        </span>
      </div>
      <span className="font-mono text-[10px] text-text-muted ml-auto">
        online
      </span>
    </header>
  );
}
