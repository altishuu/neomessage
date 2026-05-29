-- =============================================================================
-- NeoMessage — message_reactions Table
-- Target: Supabase (PostgreSQL 15+)
-- Date:   2026-05-28
-- =============================================================================
-- Context:
--   Adds support for emoji reactions on messages (message reactions / "reactji").
--   Reactions are immutable — users cannot edit a reaction, only DELETE + re-INSERT
--   to toggle. The unique constraint on (message_id, user_id, reaction) ensures
--   each user can react to a given message with a given emoji only once.
--
-- Access Model:
--   SELECT: Participants of the message's conversation (via two-level semi-join)
--   INSERT: Participant can add own reactions (user_id = auth.uid())
--   DELETE: Reactor can remove own reactions (user_id = auth.uid())
--   UPDATE: Not permitted — reactions are immutable (DELETE + re-INSERT to change)
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Section A: Create Table
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.message_reactions (
  id         uuid         primary key default gen_random_uuid(),
  message_id uuid         not null references public.messages(id)
                           on delete cascade,
  user_id    uuid         not null references public.user_profiles(user_id)
                           on delete cascade,
  reaction   text         not null,
  created_at timestamptz  not null default now(),

  constraint unique_user_reaction
    unique (message_id, user_id, reaction)
);

comment on table public.message_reactions is
  'Emoji reactions on messages. Immutable — toggle via DELETE + re-INSERT. '
  'Unique constraint prevents duplicate reactions.';

-- ────────────────────────────────────────────────────────────────────────────
-- Section B: Indexes
-- ────────────────────────────────────────────────────────────────────────────

-- Primary access pattern: fetch all reactions for a message (join on message_id)
create index if not exists idx_message_reactions_message_id
  on public.message_reactions (message_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Section C: Row-Level Security — Enable
-- ────────────────────────────────────────────────────────────────────────────

alter table public.message_reactions enable row level security;

-- ────────────────────────────────────────────────────────────────────────────
-- Section D: Row-Level Security — Policies
-- ────────────────────────────────────────────────────────────────────────────
-- All policies reference auth.uid() (Supabase Auth UUID) for consistent
-- access checks. The SELECT and INSERT policies use a two-level semi-join
-- (reactions → messages → conversation_participants) to avoid denormalizing
-- conversation_id onto the reactions table.
-- ────────────────────────────────────────────────────────────────────────────

-- D1. SELECT — participants of the message's conversation can read reactions
-- ────────────────────────────────────────────────────────────────────────────
-- Two-level semi-join: find the message's conversation, check if the user
-- is an active participant. Avoids storing conversation_id on reactions.
create policy "Participants can read reactions"
  on public.message_reactions for select
  using (
    exists (
      select 1 from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_reactions.message_id
        and cp.user_id = auth.uid()
        and cp.deleted_at is null
    )
  );

comment on policy "Participants can read reactions"
  on public.message_reactions is
  'Only active conversation participants can see reactions on messages in that conversation.';

-- D2. INSERT — participants can add their own reactions to messages in the conversation
-- ────────────────────────────────────────────────────────────────────────────
-- Must pass two checks:
--   1. The user is an active participant in the message's conversation
--   2. The reaction is attributed to the authenticated user (user_id = auth.uid())
create policy "Participants can add own reactions"
  on public.message_reactions for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_reactions.message_id
        and cp.user_id = auth.uid()
        and cp.deleted_at is null
    )
  );

comment on policy "Participants can add own reactions"
  on public.message_reactions is
  'Participants can add reactions attributed to themselves to messages in their conversations.';

-- D3. DELETE — only the reactor can remove their own reaction
-- ────────────────────────────────────────────────────────────────────────────
-- No UPDATE policy — reactions are immutable. To change a reaction, the user
-- must DELETE the old one and INSERT a new one (toggle semantics).
create policy "Users can delete own reactions"
  on public.message_reactions for delete
  using (user_id = auth.uid());

comment on policy "Users can delete own reactions"
  on public.message_reactions is
  'Users can only delete reactions they created. No UPDATE policy — reactions are immutable.';

-- ────────────────────────────────────────────────────────────────────────────
-- Section E: Realtime
-- ────────────────────────────────────────────────────────────────────────────

-- Enable Realtime for message_reactions so clients get live reaction updates.
-- REPLICA IDENTITY FULL ensures the full row (including message_id and reaction)
-- is broadcast on INSERT and DELETE.
alter publication supabase_realtime add table public.message_reactions;
alter table public.message_reactions replica identity full;

-- =============================================================================
-- Security Boundary Documentation
-- =============================================================================
-- Table:     public.message_reactions
--
-- Access Model:
--   SELECT: Active conversation participants only (via reactions → messages → cp)
--   INSERT: Active participant, must be self-attributed (user_id = auth.uid())
--   DELETE: Reactor only (user_id = auth.uid())
--   UPDATE: Not permitted — immutable by design
--
-- Key Design Decisions:
--   1. Two-level semi-join avoids denormalizing conversation_id onto reactions
--      (reactions → messages → conversation_participants). Slightly more
--      expensive per query but keeps the schema normalized.
--   2. ON DELETE CASCADE for user deletion — reactions have no meaning to
--      preserve when a user is deleted (unlike messages).
--   3. ON DELETE CASCADE for message deletion — reactions are meaningless
--      without their parent message.
--   4. No CHECK constraint on reaction text — validation happens in the API
--      layer (emoji-only), keeps DB flexible for future non-emoji reactions.
--   5. REPLICA IDENTITY FULL ensures Realtime broadcasts the full reaction row
--      on INSERT/DELETE so clients can update their UI without a refetch.
--   6. Unique constraint on (message_id, user_id, reaction) enables safe
--      idempotent toggles via ON CONFLICT DO NOTHING.
-- =============================================================================
