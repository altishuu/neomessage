"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { getConversations } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { NewConversationModal } from "@/components/chat/new-conversation-modal";

export function Sidebar() {
  const router = useRouter();
  const params = useParams();
  const activeId = params?.conversationId as string | undefined;

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

  return (
    <>
      <aside className="w-[320px] flex-shrink-0 border-r border-border bg-surface flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
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
          ) : conversations.length === 0 ? (
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
              {conversations.map((conv) => {
                const other = conv.participants[0];
                const isActive = conv.id === activeId;
                const lastMsg = conv.lastMessage;

                return (
                  <button
                    key={conv.id}
                    onClick={() => router.push(`/chat/${conv.id}`)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150",
                      "hover:bg-surface-raised border-b border-border/50",
                      isActive && "bg-surface-raised border-l-2 border-l-cyan"
                    )}
                  >
                    <Avatar
                      username={other?.username ?? "?"}
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
                          {other?.username ?? "Unknown"}
                        </span>
                        {lastMsg && (
                          <span className="font-mono text-[10px] text-text-muted flex-shrink-0">
                            {new Date(lastMsg.createdAt).toLocaleTimeString(
                              [],
                              { hour: "2-digit", minute: "2-digit" }
                            )}
                          </span>
                        )}
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
