"use client";

import type { User } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

interface ConversationHeaderProps {
  participants: User[];
  isGroup?: boolean;
  typingUsers?: string[];
  onAddParticipants?: () => void;
  onLeaveGroup?: () => void;
}

export function ConversationHeader({
  participants,
  isGroup = false,
  typingUsers = [],
  onAddParticipants,
  onLeaveGroup,
}: ConversationHeaderProps) {
  const { user } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const otherParticipants = participants.filter((p) => p.id !== user?.id);

  const displayName = isGroup
    ? participants.length > 0
      ? participants.map((p) => p.username).join(", ")
      : "Group"
    : otherParticipants.map((p) => p.username).join(", ") || "Unknown";

  // Map typing user IDs to usernames from participants, exclude current user
  const othersTyping = useMemo(() => {
    return (user ? typingUsers.filter((id) => id !== user.id) : typingUsers)
      .map((id) => participants.find((p) => p.id === id)?.username)
      .filter((u): u is string => !!u);
  }, [typingUsers, participants, user]);

  const typingText =
    othersTyping.length === 1
      ? othersTyping[0]
      : othersTyping.length > 1
        ? "several users"
        : "";

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface-raised flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            "w-2 h-2 rounded-full transition-colors duration-300 flex-shrink-0",
            othersTyping.length > 0 ? "bg-cyan animate-pulse" : "bg-green"
          )}
        />
        <div className="min-w-0">
          <span className="font-mono text-sm font-semibold text-text truncate block max-w-[200px]">
            {displayName}
          </span>
          {isGroup && (
            <span className="font-mono text-[10px] text-text-muted">
              {participants.length} participant{participants.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {othersTyping.length > 0 ? (
          <span className="font-mono text-[10px] text-cyan animate-pulse">
            ~$ {typingText} {othersTyping.length > 1 ? "are" : "is"} typing
            <span className="inline-flex ml-0.5">
              <span className="animate-typing-dot">.</span>
              <span className="animate-typing-dot animation-delay-200">.</span>
              <span className="animate-typing-dot animation-delay-400">.</span>
            </span>
          </span>
        ) : (
          <span className="font-mono text-[10px] text-text-muted">
            online
          </span>
        )}

        {/* Dropdown menu for group actions */}
        {isGroup && onAddParticipants && onLeaveGroup && (
          <div className="relative">
            <button
              onClick={() => setShowMenu((prev) => !prev)}
              className="font-mono text-xs text-text-dim hover:text-text transition-colors px-2"
            >
              ...
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-surface-raised border border-border rounded-sm shadow-lg min-w-[140px] py-1">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onAddParticipants();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left font-mono text-[11px] text-text hover:bg-surface transition-colors"
                  >
                    + Add people
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onLeaveGroup();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left font-mono text-[11px] text-red hover:bg-surface transition-colors"
                  >
                    - Leave group
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
