"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Message } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeChannel } from "./use-realtime-channel";

interface UseRealtimeMessagesOptions {
  conversationId: string;
  onMessage?: (message: Message) => void;
  /** Fires when the WebSocket reconnects after a disconnect */
  onReconnected?: () => void;
}

// ── Sender profile cache ──────────────────────────────────────────────
// Module-level cache persists across re-renders and conversation switches,
// avoiding redundant supabase queries for user profiles we've already seen.
interface SenderProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
}

const senderCache = new Map<string, SenderProfile>();

async function resolveSender(
  senderId: string | null
): Promise<SenderProfile> {
  // System messages have no sender
  if (!senderId) {
    return { id: "", username: "system", avatarUrl: null };
  }

  // Cache hit
  const cached = senderCache.get(senderId);
  if (cached) return cached;

  // Fetch from supabase
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, username, avatar_url")
      .eq("user_id", senderId)
      .single();

    if (!error && data) {
      const profile: SenderProfile = {
        id: data.user_id,
        username: data.username,
        avatarUrl: data.avatar_url,
      };
      senderCache.set(senderId, profile);
      return profile;
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback — show minimal info instead of crashing
  const fallback: SenderProfile = {
    id: senderId,
    username: "unknown",
    avatarUrl: null,
  };
  senderCache.set(senderId, fallback);
  return fallback;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useRealtimeMessages({
  conversationId,
  onMessage,
  onReconnected,
}: UseRealtimeMessagesOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const mountedRef = useRef(true);
  const onMessageRef = useRef(onMessage);

  // Keep callback ref fresh without re-triggering the effect
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // ── Channel subscription via shared reconnection hook ────────────

  const channelName = `conversation:${conversationId}`;

  const { status, error } = useRealtimeChannel(
    channelName,
    useCallback(
      (channel) => {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          async (payload) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const record = payload.new as any;
            if (!mountedRef.current) return;

            if (payload.eventType === "DELETE") {
              setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
              return;
            }

            const sender = await resolveSender(record.sender_id ?? null);

            const msg: Message = {
              id: record.id,
              content: record.content,
              senderId: record.sender_id ?? "",
              sender,
              type: record.type ?? undefined,
              conversationId: record.conversation_id,
              readAt: null,
              createdAt: record.created_at,
              updatedAt: record.updated_at,
              deletedAt: record.deleted_at ?? null,
              metadata: record.metadata ?? undefined,
            };

            if (mountedRef.current) {
              setMessages((prev) => {
                if (payload.eventType === "UPDATE") {
                  return prev.map((m) => (m.id === msg.id ? msg : m));
                }
                if (prev.some((m) => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
              onMessageRef.current?.(msg);
            }
          },
        );
      },
      [conversationId],
    ),
    onReconnected,
  );

  // ── Public API ────────────────────────────────────────────────────

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
  }, []);

  const prependMessages = useCallback((olderMessages: Message[]) => {
    setMessages((prev) => {
      // Avoid duplicates by filtering out messages we already have
      const existingIds = new Set(prev.map((m) => m.id));
      const newOnes = olderMessages.filter((m) => !existingIds.has(m.id));
      if (newOnes.length === 0) return prev;
      return [...newOnes, ...prev];
    });
  }, []);

  const setInitialMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs);
  }, []);

  return {
    messages,
    connected: status === "connected",
    error,
    addMessage,
    prependMessages,
    setInitialMessages,
  };
}
