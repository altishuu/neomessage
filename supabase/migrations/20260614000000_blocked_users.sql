-- Migration: Add blocked_users table and update RLS for user blocking
-- Date: 2026-06-14
--
-- Adds a blocked_users table for user-to-user blocking.
-- Updates existing RLS policies on messages, conversations, and
-- conversation_participants to enforce block visibility rules.
--
-- Rollback: See end of file.

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ Section A: Helper functions                                                ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- Returns true if p_blocker_id has blocked p_target_id.
create or replace function public.is_user_blocked(
  p_blocker_id uuid,
  p_target_id  uuid
)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.blocked_users
    where blocker_id = p_blocker_id
      and blocked_id = p_target_id
  );
$$;

comment on function public.is_user_blocked(uuid, uuid) is
  'Returns true if p_blocker_id has blocked p_target_id.';

-- Returns true if p_sender_id is blocked by any active participant in
-- the given conversation. Used in the message INSERT policy to prevent
-- blocked users from sending messages.
create or replace function public.is_sender_blocked_in_conversation(
  p_sender_id      uuid,
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.conversation_participants cp
    inner join public.blocked_users bu
      on bu.blocker_id = cp.user_id
      and bu.blocked_id = p_sender_id
    where cp.conversation_id = p_conversation_id
      and cp.deleted_at is null
  );
$$;

comment on function public.is_sender_blocked_in_conversation(uuid, uuid) is
  'Returns true if p_sender_id is blocked by any participant in p_conversation_id.';


-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ Section B: blocked_users table                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

create table if not exists public.blocked_users (
  blocker_id uuid        not null references auth.users(id) on delete cascade,
  blocked_id uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint blocked_users_pkey primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

comment on table public.blocked_users is
  'User-to-user blocks. blocker_id blocks blocked_id. One-directional.';

-- Fast lookup: who has X blocked? (used by blocker's blocked list)
create index if not exists idx_blocked_users_blocker
  on public.blocked_users (blocker_id);

-- Fast lookup: who has blocked X? (used by RLS policies)
create index if not exists idx_blocked_users_blocked
  on public.blocked_users (blocked_id);


-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ Section C: RLS on blocked_users table                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

alter table public.blocked_users enable row level security;

-- Users can see who they've blocked
create policy "Users can view own blocks"
  on public.blocked_users for select
  using (blocker_id = auth.uid());

-- Users can see if they've been blocked (so they know they can't message back)
create policy "Users can view if they've been blocked"
  on public.blocked_users for select
  using (blocked_id = auth.uid());

-- Users can block other users
create policy "Users can block other users"
  on public.blocked_users for insert
  with check (blocker_id = auth.uid());

-- Users can unblock (delete their own block entries)
create policy "Users can unblock"
  on public.blocked_users for delete
  using (blocker_id = auth.uid());


-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ Section D: Update message RLS policies for blocking                         ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- Drop existing policies that need blocking awareness
drop policy if exists "Participants can read messages" on public.messages;
drop policy if exists "Participants can insert messages" on public.messages;

-- Recreate: participants can read messages, but EXCLUDE messages where
-- the viewer has blocked the sender OR the viewer is blocked by the sender.
-- This implements: "blocker cannot see blocked user's messages".
create policy "Participants can read messages"
  on public.messages for select
  using (
    exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.user_id = auth.uid()
        and cp.deleted_at is null
    )
    -- Blocked-user filter: hide messages from/to blocked users
    and not is_user_blocked(auth.uid(), messages.sender_id)
    and not is_user_blocked(messages.sender_id, auth.uid())
  );

-- Recreate: participants can insert messages, but REJECT if the sender
-- is blocked by any active participant in the conversation.
-- This implements: "blocked users cannot send messages to blocker".
create policy "Participants can insert messages"
  on public.messages for insert
  with check (
    exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.user_id = auth.uid()
        and cp.deleted_at is null
    )
    and (sender_id = auth.uid() or type = 'system')
    -- Blocked-user guard: prevent blocked users from sending
    and not is_sender_blocked_in_conversation(auth.uid(), messages.conversation_id)
  );


-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ Section E: Update conversation RLS for blocking                             ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- Drop existing conversation select policy
drop policy if exists "Participants can view conversations"
  on public.conversations;

-- Recreate: participants can view conversations, but hide conversations
-- where the current user has been blocked by any active participant.
-- This prevents the blocked user from seeing the blocker's conversation.
create policy "Participants can view conversations"
  on public.conversations for select
  using (
    exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = conversations.id
        and cp.user_id = auth.uid()
        and cp.deleted_at is null
        -- Exclude conversations where any participant has blocked the viewer
        and not exists (
          select 1
          from public.blocked_users bu
          where bu.blocked_id = auth.uid()
            and bu.blocker_id in (
              select cp2.user_id
              from public.conversation_participants cp2
              where cp2.conversation_id = conversations.id
                and cp2.deleted_at is null
            )
        )
    )
  );


-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ Section F: Update conversation_participants RLS for blocking                ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- Drop existing participant view policy
drop policy if exists "Participants can view who else is in their conversations"
  on public.conversation_participants;

-- Recreate: participants can see other participants, but blocked users
-- are hidden from the list (the blocker won't see the blocked user's
-- participation, and the blocked user won't see the blocker).
create policy "Participants can view who else is in their conversations"
  on public.conversation_participants for select
  using (
    -- Users can always see their own membership
    user_id = auth.uid()
    or (
      -- Other users' memberships, visible if:
      exists (
        select 1
        from public.conversation_participants cp
        where cp.conversation_id = conversation_participants.conversation_id
          and cp.user_id = auth.uid()
          and cp.deleted_at is null
      )
      -- But hide participants who have blocked the viewer or whom the viewer has blocked
      and not is_user_blocked(conversation_participants.user_id, auth.uid())
      and not is_user_blocked(auth.uid(), conversation_participants.user_id)
    )
  );


-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ ROLLBACK                                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- To revert this migration, run the following in order:
--
--   1. Drop policies on blocked_users:
--      drop policy if exists "Users can unblock" on public.blocked_users;
--      drop policy if exists "Users can block other users" on public.blocked_users;
--      drop policy if exists "Users can view if they've been blocked" on public.blocked_users;
--      drop policy if exists "Users can view own blocks" on public.blocked_users;
--
--   2. Drop blocked_users table:
--      drop table if exists public.blocked_users;
--
--   3. Drop helper functions:
--      drop function if exists public.is_sender_blocked_in_conversation(uuid, uuid);
--      drop function if exists public.is_user_blocked(uuid, uuid);
--
--   4. Restore original RLS policies (from init migration):
--      drop policy if exists "Participants can read messages" on public.messages;
--      create policy "Participants can read messages" on public.messages for select
--        using (
--          exists (
--            select 1 from public.conversation_participants
--            where conversation_id = messages.conversation_id
--              and user_id = auth.uid()
--              and deleted_at is null
--          )
--        );
--
--      drop policy if exists "Participants can insert messages" on public.messages;
--      create policy "Participants can insert messages" on public.messages for insert
--        with check (
--          exists (
--            select 1 from public.conversation_participants
--            where conversation_id = messages.conversation_id
--              and user_id = auth.uid()
--              and deleted_at is null
--          )
--          and (sender_id = auth.uid() or type = 'system')
--        );
--
--      drop policy if exists "Participants can view conversations" on public.conversations;
--      create policy "Participants can view conversations" on public.conversations for select
--        using (
--          exists (
--            select 1 from public.conversation_participants
--            where conversation_id = conversations.id
--              and user_id = auth.uid()
--              and deleted_at is null
--          )
--        );
--
--      drop policy if exists "Participants can view who else is in their conversations"
--        on public.conversation_participants;
--      create policy "Participants can view who else is in their conversations"
--        on public.conversation_participants for select
--        using (
--          user_id = auth.uid()
--          or exists (
--            select 1 from public.conversation_participants cp
--            where cp.conversation_id = conversation_participants.conversation_id
--              and cp.user_id = auth.uid()
--              and cp.deleted_at is null
--          )
--        );
