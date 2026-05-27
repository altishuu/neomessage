"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Message } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

interface UseRealtimeMessagesOptions {
  conversationId: string;
  onMessage?: (message: Message) => void;
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
}: UseRealtimeMessagesOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const onMessageRef = useRef(onMessage);

  // Keep callback ref fresh without re-triggering the effect
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // ── Public API ────────────────────────────────────────────────────

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
  }, []);

  const setInitialMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs);
  }, []);

  // ── Subscription ──────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    const supabase = createClient();
    const channelName = `conversation:${conversationId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const record = payload.new as any;
          if (!mountedRef.current) return;

          const sender = await resolveSender(record.sender_id ?? null);

          const msg: Message = {
            id: record.id,
            content: record.content,
            senderId: record.sender_id ?? "",
            sender,
            conversationId: record.conversation_id,
            readAt: null,
            createdAt: record.created_at,
          };

          if (mountedRef.current) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            onMessageRef.current?.(msg);
          }
        }
      )
      .subscribe((status) => {
        if (!mountedRef.current) return;

        switch (status) {
          case "SUBSCRIBED":
            setConnected(true);
            setError(null);
            break;
          case "CHANNEL_ERROR":
          case "TIMED_OUT":
            setConnected(false);
            setError("Connection lost, reconnecting...");
            break;
          case "CLOSED":
            setConnected(false);
            break;
        }
      });

    // ── Cleanup ───────────────────────────────────────────────────
    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return {
    messages,
    connected,
    error,
    addMessage,
    setInitialMessages,
  };
}
