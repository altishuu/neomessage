"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Reaction } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type ReactionRow = Database["public"]["Tables"]["message_reactions"]["Row"];

// ── Reactor profile cache ────────────────────────────────────────────────
// Module-level cache persists across re-renders and conversation switches,
// avoiding redundant supabase queries for user profiles we've already seen.
interface ReactorProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
}

const reactorCache = new Map<string, ReactorProfile>();

async function resolveReactor(
  userId: string | null
): Promise<ReactorProfile> {
  // System actors have no user
  if (!userId) {
    return { id: "", username: "system", avatarUrl: null };
  }

  // Cache hit
  const cached = reactorCache.get(userId);
  if (cached) return cached;

  // Fetch from supabase
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, username, avatar_url")
      .eq("user_id", userId)
      .single();

    if (!error && data) {
      const profile: ReactorProfile = {
        id: data.user_id,
        username: data.username,
        avatarUrl: data.avatar_url,
      };
      reactorCache.set(userId, profile);
      return profile;
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback — show minimal info instead of crashing
  const fallback: ReactorProfile = {
    id: userId,
    username: "unknown",
    avatarUrl: null,
  };
  reactorCache.set(userId, fallback);
  return fallback;
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useRealtimeReactions(
  conversationId: string,
  messageIds: string[]
) {
  const [reactionsByMessage, setReactionsByMessage] = useState<
    Record<string, Reaction[]>
  >({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  // ── Fetch reactions for new messages ─────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    const pendingIds = messageIds.filter(
      (id) => !fetchedRef.current.has(id)
    );
    if (pendingIds.length === 0) return;

    // Mark as fetched immediately to prevent duplicate fetches
    pendingIds.forEach((id) => fetchedRef.current.add(id));

    pendingIds.forEach(async (messageId) => {
      try {
        const res = await fetch(`/api/messages/${messageId}/reactions`);
        if (!res.ok) return;
        const data = await res.json();
        if (!mountedRef.current) return;

        setReactionsByMessage((prev) => {
          // Don't overwrite if we already have data from realtime
          if (prev[messageId]?.length && data.reactions?.length) return prev;
          return {
            ...prev,
            [messageId]: (data.reactions as Reaction[]) ?? [],
          };
        });
      } catch {
        // Silently fail — reactions are non-critical UX
      }
    });
  }, [messageIds]);

  // ── Realtime subscription ────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    const supabase = createClient();
    const channelName = `reactions:${conversationId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
        },
        async (payload) => {
          if (!mountedRef.current) return;
          const record = payload.new as ReactionRow | null;
          if (!record) return;

          // Resolve the reactor's profile
          const reactor = await resolveReactor(record.user_id ?? null);

          const newReaction: Reaction = {
            id: record.id,
            messageId: record.message_id,
            userId: record.user_id ?? "",
            reaction: record.reaction,
            createdAt: record.created_at,
            user: reactor.id
              ? {
                  id: reactor.id,
                  username: reactor.username,
                  avatarUrl: reactor.avatarUrl,
                }
              : null,
          };

          if (!mountedRef.current) return;

          setReactionsByMessage((prev) => {
            const existing = prev[record.message_id] ?? [];
            // Deduplicate — realtime may fire before the fetch completes
            if (existing.some((r) => r.id === newReaction.id)) return prev;
            return {
              ...prev,
              [record.message_id]: [...existing, newReaction],
            };
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
        },
        (payload) => {
          if (!mountedRef.current) return;
          const oldRecord = payload.old as ReactionRow | null;
          if (!oldRecord) return;

          setReactionsByMessage((prev) => {
            const existing = prev[oldRecord.message_id] ?? [];
            return {
              ...prev,
              [oldRecord.message_id]: existing.filter(
                (r) => r.id !== oldRecord.id
              ),
            };
          });
        }
      )
      .subscribe((status) => {
        if (!mountedRef.current) return;
        // Reactions subscription status is non-critical — don't surface to user
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[reactions] subscription error, will retry automatically");
        }
      });

    // ── Cleanup ─────────────────────────────────────────────────────────
    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // ── Helpers ────────────────────────────────────────────────────────────

  const getMessageReactions = useCallback(
    (messageId: string): Reaction[] => {
      return reactionsByMessage[messageId] ?? [];
    },
    [reactionsByMessage]
  );

  return {
    reactionsByMessage,
    getMessageReactions,
  };
}
