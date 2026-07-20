"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface UseRealtimeChannelReturn {
  status: ConnectionStatus;
  error: string | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * Manages a Supabase Realtime channel subscription with automatic
 * reconnection using exponential backoff (1s → 2s → 4s → … → 30s max).
 *
 * @param channelName   Unique channel name (e.g. `conversation:{id}`)
 * @param setupChannel  Callback to attach `.on()` handlers to the channel
 * @param onReconnected Optional — fires when a reconnection succeeds
 */
export function useRealtimeChannel(
  channelName: string | null,
  setupChannel: (channel: RealtimeChannel) => void,
  onReconnected?: () => void,
): UseRealtimeChannelReturn {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  // ── Refs for stable callbacks ────────────────────────────────────
  const mountedRef = useRef(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const wasReconnectingRef = useRef(false);

  // Keep callbacks in refs so .subscribe() closures always see latest
  const setupChannelRef = useRef(setupChannel);
  const onReconnectedRef = useRef(onReconnected);

  useEffect(() => {
    setupChannelRef.current = setupChannel;
  }, [setupChannel]);

  useEffect(() => {
    onReconnectedRef.current = onReconnected;
  }, [onReconnected]);

  // ── Cleanup helper ───────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (channelRef.current) {
      try {
        const supabase = createClient();
        supabase.removeChannel(channelRef.current);
      } catch {
        // Channel may already be gone — swallow
      }
      channelRef.current = null;
    }
  }, []);

  // ── Subscribe (or re-subscribe) ──────────────────────────────────
  const subscribe = useCallback(() => {
    if (!mountedRef.current) return;

    cleanup();

    const supabase = createClient();
    const channel = supabase.channel(channelName!);
    setupChannelRef.current(channel);

    channel.subscribe((statusCode) => {
      if (!mountedRef.current) return;

      switch (statusCode) {
        case "SUBSCRIBED": {
          if (wasReconnectingRef.current) {
            wasReconnectingRef.current = false;
            // Fire asynchronously so React can batch state updates
            queueMicrotask(() => onReconnectedRef.current?.());
          }
          setStatus("connected");
          setError(null);
          reconnectAttemptRef.current = 0;
          break;
        }

        case "CHANNEL_ERROR":
        case "TIMED_OUT": {
          wasReconnectingRef.current = true;
          setStatus("reconnecting");
          setError("Connection lost, reconnecting...");

          // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
          const attempt = reconnectAttemptRef.current;
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          reconnectAttemptRef.current = attempt + 1;

          timerRef.current = setTimeout(() => {
            if (mountedRef.current) subscribe();
          }, delay);
          break;
        }

        case "CLOSED": {
          setStatus("disconnected");
          setError(null);
          break;
        }
      }
    });

    channelRef.current = channel;
  }, [cleanup, channelName]);

  // ── Mount effect ─────────────────────────────────────────────────
  useEffect(() => {
    if (!channelName) return;

    mountedRef.current = true;
    wasReconnectingRef.current = false;
    reconnectAttemptRef.current = 0;
    setStatus("connecting");
    setError(null);

    subscribe();

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [channelName, subscribe, cleanup]);

  return { status, error };
}
