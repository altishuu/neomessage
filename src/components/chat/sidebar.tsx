"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { getConversations, togglePin } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import type { Conversation } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { NewConversationModal } from "@/components/chat/new-conversation-modal";
import { AvatarDropdown } from "@/components/chat/avatar-dropdown";

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      className={cn(
        "w-3.5 h-3.5 transition-colors duration-150",
        pinned
          ? "text-cyan"
          : "text-text-muted group-hover/conversation:text-text-dim"
      )}
      fill={pinned ? "currentColor" : "none"}
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={pinned ? 0 : 2}
    >
      {pinned ? (
        /* Filled pin (thumbtack) */
        <path d="M16 12V4h1a1 1 0 000-2H7a1 1 0 000 2h1v8l-2 2v2h5.2v6l.8.8.8-.8v-6H18v-2l-2-2z" />
      ) : (
        /* Outline pin (thumbtack) */
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 4H9m6 0v8l2 2v2H7v-2l2-2V4m6 0h1a1 1 0 000-2H8a1 1 0 000 2h1"
        />
      )}
    </svg>
  );
}

export function Sidebar() {
  const router = useRouter();
  const params = useParams();
  const activeId = params?.conversationId as string | undefined;
  const { user } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);

  const fetchConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data.conversations);
    } catch {
      // Silently handle — errors expected if not logged in
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Refresh on new conversation modal close
  const handleConversationCreated = useCallback(
    (conv: Conversation) => {
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== conv.id);
        return [conv, ...filtered];
      });
      setShowNewModal(false);
      router.push(`/chat/${conv.id}`);
    },
    [router]
  );

  // Client-side sort: pinned first, then by lastMessageAt desc
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (
        new Date(b.lastMessageAt ?? 0).getTime() -
        new Date(a.lastMessageAt ?? 0).getTime()
      );
    });
  }, [conversations]);

  const handleTogglePin = useCallback(
    async (convId: string, currentPinned: boolean) => {
      // Snapshot for rollback
      const snapshot = conversations;
      const newPinned = !currentPinned;

      // Optimistic update
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, isPinned: newPinned } : c))
      );

      try {
        await togglePin(convId, newPinned);
      } catch {
        // Rollback on error
        setConversations(snapshot);
      }
    },
    [conversations]
  );

  return (
    <>
      <aside className="w-[320px] flex-shrink-0 border-r border-border bg-surface flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <AvatarDropdown />
            <h1 className="font-mono text-sm font-bold text-cyan tracking-wider uppercase">
              NeoMessage
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNewModal(true)}
            className="text-text-dim hover:text-cyan"
          >
            + New
          </Button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-sm bg-surface-overlay" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-24 rounded bg-surface-overlay" />
                    <div className="h-2 w-40 rounded bg-surface-overlay" />
                  </div>
                </div>
              ))}
            </div>
          ) : sortedConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <p className="font-mono text-text-dim text-sm mb-4">
                ~$ no conversations found
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowNewModal(true)}
              >
                Start a conversation
              </Button>
            </div>
          ) : (
            <div className="py-1">
              {sortedConversations.map((conv) => {
                // For DMs, show the conversation partner (not the current user).
                // For groups, show the title (or fall back to participant names).
                const otherParticipants = user
                  ? conv.participants.filter((p) => p.id !== user.id)
                  : conv.participants;
                const other = conv.isGroup
                  ? null
                  : otherParticipants[0];
                const displayName = conv.title
                  ? conv.title
                  : (other?.username ?? otherParticipants[0]?.username ?? "Unknown");
                const isActive = conv.id === activeId;
                const lastMsg = conv.lastMessage;

                return (
                  <button
                    key={conv.id}
                    onClick={() => router.push(`/chat/${conv.id}`)}
                    className={cn(
                      "group/conversation w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150",
                      "hover:bg-surface-raised border-b border-border/50",
                      isActive && "bg-surface-raised border-l-2 border-l-cyan"
                    )}
                  >
                    <Avatar
                      username={displayName}
                      avatarUrl={other?.avatarUrl}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "font-mono text-sm truncate",
                            isActive ? "text-cyan" : "text-text"
                          )}
                        >
                          {displayName}
                        </span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* Pin toggle — always visible when pinned, on hover when unpinned */}
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTogglePin(conv.id, conv.isPinned);
                            }}
                            className={cn(
                              "flex items-center justify-center",
                              !conv.isPinned &&
                                "opacity-0 group-hover/conversation:opacity-100 transition-opacity"
                            )}
                          >
                            <PinIcon pinned={conv.isPinned} />
                          </span>
                          {lastMsg && (
                            <span className="font-mono text-[10px] text-text-muted">
                              {new Date(lastMsg.createdAt).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" }
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                      {lastMsg ? (
                        <p className="font-mono text-xs text-text-dim truncate mt-0.5">
                          {lastMsg.content}
                        </p>
                      ) : (
                        <p className="font-mono text-xs text-text-muted truncate mt-0.5">
                          No messages yet
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {showNewModal && (
        <NewConversationModal
          onClose={() => setShowNewModal(false)}
          onConversationCreated={handleConversationCreated}
        />
      )}
    </>
  );
}
