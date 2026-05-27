"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getConversation, sendMessage } from "@/lib/api";
import { useRealtimeMessages } from "@/lib/hooks/use-realtime-messages";
import { ConversationHeader } from "@/components/chat/conversation-header";
import { MessageList } from "@/components/chat/message-list";
import { MessageInput } from "@/components/chat/message-input";
import type { Conversation } from "@/lib/types";

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params?.conversationId as string;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const {
    messages,
    connected,
    error: realtimeError,
    setInitialMessages,
    addMessage,
  } = useRealtimeMessages({
    conversationId,
    onMessage: (msg) => {
      // Messages already added by the hook
    },
  });

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
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Failed to send");
      }
    },
    [conversationId, addMessage]
  );

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
      <ConversationHeader participants={conversation.participants} />

      {/* Connection status */}
      {!connected && (
        <div className="px-4 py-1.5 bg-amber/10 border-b border-amber/30">
          <p className="font-mono text-[10px] text-amber text-center">
            {realtimeError || "~$ reconnecting..."}
          </p>
        </div>
      )}

      {/* Messages */}
      <MessageList messages={messages} loading={false} />

      {/* Send error */}
      {sendError && (
        <div className="px-4 py-1.5 bg-red/10 border-t border-red/30">
          <p className="font-mono text-[10px] text-red">{sendError}</p>
        </div>
      )}

      {/* Input */}
      <MessageInput onSend={handleSend} />
    </div>
  );
}
