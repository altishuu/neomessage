"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Message } from "@/lib/types";

interface UseRealtimeMessagesOptions {
  conversationId: string;
  onMessage?: (message: Message) => void;
}

export function useRealtimeMessages({
  conversationId,
  onMessage,
}: UseRealtimeMessagesOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/sse", { withCredentials: true });

    es.onopen = () => {
      if (mountedRef.current) {
        setConnected(true);
        setError(null);
      }
    };

    es.addEventListener("connected", () => {
      if (mountedRef.current) setConnected(true);
    });

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (
          parsed.type === "new_message" &&
          parsed.data?.conversationId === conversationId
        ) {
          const msg = parsed.data as Message;
          if (mountedRef.current) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            onMessage?.(msg);
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      if (mountedRef.current) {
        setConnected(false);
        setError("Connection lost, reconnecting...");
        es.close();
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, 3000);
      }
    };

    eventSourceRef.current = es;
  }, [conversationId, onMessage]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
  }, []);

  const setInitialMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs);
  }, []);

  return {
    messages,
    connected,
    error,
    addMessage,
    setInitialMessages,
  };
}
