-- =============================================================================
-- NeoMessage — Fix recursive RLS policy on conversation_participants
-- Target: Supabase (PostgreSQL 15+)
-- Date:   2026-07-21
-- =============================================================================
--
-- Root Cause:
--   The policy "Participants can view who else is in their conversations"
--   uses a self-referential subquery on `conversation_participants` that
--   triggers the same RLS policy, causing infinite recursion (error 42P17).
--
-- Fix:
--   Create a security definer function to check participant membership
--   (bypasses RLS), then rewrite the policy to use it instead of a
--   direct self-referential subquery.
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Step 1: Create a security-definer helper to check conversation membership
-- ────────────────────────────────────────────────────────────────────────────
-- This function runs with the privileges of the function owner (superuser /
-- table owner), bypassing RLS entirely.  It is STABLE (same result within a
-- transaction for the same arguments) and LEAKPROOF-safe for use in policies.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.is_conversation_participant(conv_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = auth.uid() and deleted_at is null
  );
$$;

comment on function public.is_conversation_participant(uuid) is
  'Security-definer check: is the current auth user an active participant in the given conversation?  Bypasses RLS to avoid recursive policy evaluation.';


-- ────────────────────────────────────────────────────────────────────────────
-- Step 2: Replace the recursive policy
-- ────────────────────────────────────────────────────────────────────────────
-- The old version referenced conversation_participants inside a subquery on
-- the same table, causing the policy to fire recursively.  The new version
-- delegates the membership check to the security-definer function above.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Participants can view who else is in their conversations"
  on public.conversation_participants;

create policy "Participants can view who else is in their conversations"
  on public.conversation_participants for select
  using (
    user_id = auth.uid()
    or public.is_conversation_participant(conversation_participants.conversation_id)
  );

-- =============================================================================
-- End of migration
-- =============================================================================
