import { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

interface TypingPresence {
  typingUsers: string[];
  broadcastTyping: () => void;
  stopTyping: () => void;
}

export interface TypingUser {
  userId: string;
  username: string;
}

/**
 * Hook to handle typing presence in a conversation using Supabase Realtime Presence.
 * 
 * @param conversationId The unique identifier for the conversation channel.
 * @param userId The ID of the current user.
 */
export function useTypingPresence(conversationId: string, userId: string): TypingPresence {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const supabase = useRef(createClient());
  const channelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastBroadcastRef = useRef<number>(0);

  useEffect(() => {
    if (!conversationId || !userId) return;

    const channel = supabase.current.channel(`presence:conversation:${conversationId}`, {
      config: {
        presence: {
          key: userId,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ userId: string; typing: boolean }>();
        const users = Object.entries(state)
          .flatMap(([, members]) =>
            members.filter((m) => m.typing === true).map((m) => m.userId)
          )
          .filter((id) => id !== userId);

        setTypingUsers([...new Set(users)]);
      })
      .on('presence', { event: 'join' }, (payload) => {
        const users = payload.newPresences
          .filter((m) => m.typing === true)
          .map((m) => m.userId)
          .filter((id) => id !== userId);

        setTypingUsers((prev) => [...new Set([...prev, ...users])]);
      })
      .on('presence', { event: 'leave' }, () => {
        const state = channel.presenceState<{ userId: string; typing: boolean }>();
        const users = Object.entries(state)
          .flatMap(([, members]) =>
            members.filter((m) => m.typing === true).map((m) => m.userId)
          )
          .filter((id) => id !== userId);

        setTypingUsers([...new Set(users)]);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId,
            typing: false,
          });
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.current.removeChannel(channelRef.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [conversationId, userId]);

  const stopTyping = useCallback(async () => {
    if (!channelRef.current) return;

    await channelRef.current.track({
      userId,
      typing: false,
    });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  }, [userId]);

  const broadcastTyping = useCallback(async () => {
    if (!channelRef.current) return;

    const now = Date.now();
    if (now - lastBroadcastRef.current < 2000) {
      return;
    }

    lastBroadcastRef.current = now;

    await channelRef.current.track({
      userId,
      typing: true,
    });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 1500);
  }, [userId, stopTyping]);

  return {
    typingUsers,
    broadcastTyping,
    stopTyping,
  };
}
