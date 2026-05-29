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
          lateJoin: true,
        },
      },
    });

    channel
      .on('presence.state', { event: 'sync' }, () => {
        const state = channel.presenceState();
        // Extract user IDs who are currently marked as typing
        const users = Object.entries(state)
          .flatMap(([id, members]) => 
            members.filter((m: any) => m.typing === true).map((m: any) => m.userId)
          )
          .filter((id) => id !== userId); // Exclude current user
        
        setTypingUsers([...new Set(users)]);
      })
      .on('presence.state', { event: 'join' }, ({ members }) => {
        const users = members
          .filter((m: any) => m.typing === true)
          .map((m: any) => m.userId)
          .filter((id) => id !== userId);
        
        setTypingUsers((prev) => [...new Set([...prev, ...users])]);
      })
      .on('presence.state', { event: 'leave' }, ({ members }) => {
        // Recalculate based on current state since leave events just tell us who left
        const state = channel.presenceState();
        const users = Object.entries(state)
          .flatMap(([id, members]) => 
            members.filter((m: any) => m.typing === true).map((m: any) => m.userId)
          )
          .filter((id) => id !== userId);
        
        setTypingUsers([...new Set(users)]);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Initial track to be present in the channel without typing
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
    // Throttle broadcasts to once per 2s
    if (now - lastBroadcastRef.current < 2000) {
      return;
    }

    lastBroadcastRef.current = now;

    await channelRef.current.track({
      userId,
      typing: true,
    });

    // Auto-cleanup after 4s inactivity
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
