"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getConversation, sendMessage, addParticipants, removeParticipant, deleteConversation, searchUsers } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeMessages } from "@/lib/hooks/use-realtime-messages";
import { useTypingPresence } from "@/lib/hooks/use-typing-presence";
import { ConversationHeader } from "@/components/chat/conversation-header";
import { MessageList } from "@/components/chat/message-list";
import ChatInputContainer from "@/components/chat/chat-input-container";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Conversation, User } from "@/lib/types";

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params?.conversationId as string;

  const { user } = useAuth();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showAddParticipants, setShowAddParticipants] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState("");
  const [addSearchResults, setAddSearchResults] = useState<User[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addSearchError, setAddSearchError] = useState<string | null>(null);
  const [addingUsers, setAddingUsers] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  const {
    messages,
    connected,
    error: realtimeError,
    setInitialMessages,
    addMessage,
  } = useRealtimeMessages({
    conversationId,
    onMessage: () => {
      // Messages already added by the hook
    },
    onReconnected: useCallback(() => {
      setShowReconnected(true);
    }, []),
  });

  // ── Typing presence ──────────────────────────────────────────────
  const {
    typingUsers,
    broadcastTyping,
    stopTyping,
  } = useTypingPresence(conversationId, user?.id ?? "");

  // Fetch conversation data
  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getConversation(conversationId)
      .then((data) => {
        if (cancelled) return;
        setConversation(data.conversation);
        setInitialMessages(data.conversation.messages ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load conversation";
        setError(msg);
        if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("access denied")) {
          router.push("/chat");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, setInitialMessages, router]);

  const handleSend = useCallback(
    async (content: string) => {
      setSendError(null);
      try {
        const { message } = await sendMessage(conversationId, content);
        addMessage(message);
        // Stop typing indicator when message is sent
        stopTyping();
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Failed to send");
      }
    },
    [conversationId, addMessage, stopTyping]
  );

  // ── Add participants search ─────────────────────────────────────
  useEffect(() => {
    if (!showAddParticipants || addSearchQuery.trim().length < 2) {
      setAddSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setAddSearching(true);
      try {
        const data = await searchUsers(addSearchQuery.trim());
        // Filter out current participants
        const currentIds = new Set(
          (conversation?.participants ?? []).map((p) => p.id)
        );
        setAddSearchResults(
          data.users.filter((u) => !currentIds.has(u.id))
        );
      } catch {
        setAddSearchResults([]);
      } finally {
        setAddSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [showAddParticipants, addSearchQuery, conversation?.participants]);

  const handleAddUser = useCallback(
    async (userId: string) => {
      if (!conversation) return;
      setAddingUsers(true);
      setAddSearchError(null);
      try {
        const result = await addParticipants(conversation.id, [userId]);
        // Update conversation participants list
        setConversation((prev) => {
          if (!prev) return prev;
          const alreadyExists = prev.participants.some(
            (p) => p.id === userId
          );
          if (alreadyExists) return prev;
          const newParticipant = result.participants[0];
          if (!newParticipant) return prev;
          return {
            ...prev,
            participants: [
              ...prev.participants,
              {
                id: newParticipant.id,
                username: newParticipant.username,
                email: null,
                displayName: newParticipant.displayName ?? undefined,
                avatarUrl: newParticipant.avatarUrl,
              },
            ],
          };
        });
        // Remove added user from search results
        setAddSearchResults((prev) =>
          prev.filter((u) => u.id !== userId)
        );
      } catch (err) {
        setAddSearchError(
          err instanceof Error ? err.message : "Failed to add user"
        );
      } finally {
        setAddingUsers(false);
      }
    },
    [conversation]
  );

  const handleLeaveGroup = useCallback(async () => {
    if (!conversation) return;
    try {
      await removeParticipant(conversation.id);
      router.push("/chat");
    } catch (err) {
      console.error("Failed to leave group:", err);
    }
  }, [conversation, router]);

  const handleDeleteConversation = useCallback(async () => {
    if (!conversation) return;
    try {
      await deleteConversation(conversation.id);
      router.push("/chat");
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  }, [conversation, router]);

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center">
          <p className="font-mono text-sm text-text-dim animate-pulse">
            ~$ loading conversation...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center px-4">
          <p className="font-mono text-sm text-red mb-2">
            [error] {error || "Conversation not found"}
          </p>
          <button
            onClick={() => router.push("/chat")}
            className="font-mono text-xs text-cyan hover:text-cyan/80 underline underline-offset-2"
          >
            Back to conversations
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <ConversationHeader
        participants={conversation.participants}
        isGroup={conversation.isGroup}
        typingUsers={typingUsers}
        onAddParticipants={
          conversation.isGroup
            ? () => setShowAddParticipants(true)
            : undefined
        }
        onLeaveGroup={
          conversation.isGroup
            ? () => setShowConfirmLeave(true)
            : undefined
        }
        onDeleteConversation={
          () => setShowConfirmDelete(true)
        }
      />

      {/* Realtime connection status */}
      {!connected && (
        <div className="px-4 py-1.5 bg-amber/10 border-b border-amber/30">
          <p className="font-mono text-[10px] text-amber text-center animate-pulse">
            ~$ Connection lost — reconnecting...
          </p>
        </div>
      )}

      {/* Reconnected toast */}
      {showReconnected && (
        <Toast
          message="Reconnected"
          type="success"
          onDismiss={() => setShowReconnected(false)}
        />
      )}

      {/* Messages */}
      <MessageList
        messages={messages}
        loading={false}
        typingUsers={typingUsers}
        conversationId={conversationId}
      />

      {/* Send error */}
      {sendError && (
        <div className="px-4 py-1.5 bg-red/10 border-t border-red/30">
          <p className="font-mono text-[10px] text-red">{sendError}</p>
        </div>
      )}

      {/* Input */}
      <ChatInputContainer
        onSend={handleSend}
        onTypingChange={(typing) => {
          if (typing) {
            broadcastTyping();
          } else {
            stopTyping();
          }
        }}
      />

      {/* Add Participants Modal */}
      {showAddParticipants && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddParticipants(false);
          }}
        >
          <div className="w-full max-w-md bg-surface-raised border border-border rounded-sm shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-mono text-sm font-bold text-cyan uppercase tracking-wider">
                ~$ Add People
              </h2>
              <button
                onClick={() => setShowAddParticipants(false)}
                className="font-mono text-xs text-text-dim hover:text-text transition-colors"
              >
                [x]
              </button>
            </div>
            <div className="px-4 py-3">
              <input
                type="text"
                value={addSearchQuery}
                onChange={(e) => setAddSearchQuery(e.target.value)}
                placeholder="Search by username..."
                className="w-full bg-surface border border-border rounded-sm px-3 py-2.5 font-mono text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/30 transition-colors duration-150"
                autoFocus
              />
            </div>
            {addSearchError && (
              <div className="px-4 pb-2">
                <p className="font-mono text-xs text-red">{addSearchError}</p>
              </div>
            )}
            <div className="max-h-48 overflow-y-auto border-t border-border">
              {addSearching ? (
                <div className="flex items-center justify-center py-8">
                  <p className="font-mono text-xs text-text-dim animate-pulse">
                    Searching...
                  </p>
                </div>
              ) : addSearchQuery.trim().length < 2 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="font-mono text-xs text-text-muted">
                    Type at least 2 characters to search
                  </p>
                </div>
              ) : addSearchResults.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="font-mono text-xs text-text-dim">
                    ~$ no users found
                  </p>
                </div>
              ) : (
                <div className="py-1">
                  {addSearchResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleAddUser(u.id)}
                      disabled={addingUsers}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface border-b border-border/50 last:border-b-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Avatar
                        username={u.username}
                        avatarUrl={u.avatarUrl}
                        size="md"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-sm text-text">
                          {u.username}
                        </span>
                        <p className="font-mono text-xs text-text-dim truncate mt-0.5">
                          {u.email}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] text-cyan">
                        {addingUsers ? "Adding..." : "+ Add"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end px-4 py-3 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddParticipants(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Leave group confirmation */}
      {showConfirmLeave && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirmLeave(false);
          }}
        >
          <div className="w-full max-w-sm bg-surface-raised border border-border rounded-sm shadow-2xl p-6">
            <h3 className="font-mono text-sm font-bold text-text mb-2">
              ~$ Leave group?
            </h3>
            <p className="font-mono text-xs text-text-dim mb-6">
              You will no longer see messages from this group conversation.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirmLeave(false)}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleLeaveGroup}
                className="!text-red !border-red/30 hover:!bg-red/10"
              >
                Leave
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete conversation confirmation */}
      {showConfirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirmDelete(false);
          }}
        >
          <div className="w-full max-w-sm bg-surface-raised border border-border rounded-sm shadow-2xl p-6">
            <h3 className="font-mono text-sm font-bold text-text mb-2">
              ~$ Delete conversation?
            </h3>
            <p className="font-mono text-xs text-text-dim mb-6">
              This will remove the conversation from your sidebar. Other participants will not be affected.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowConfirmDelete(false);
                  handleDeleteConversation();
                }}
                className="!text-red !border-red/30 hover:!bg-red/10"
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
