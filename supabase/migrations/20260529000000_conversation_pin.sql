-- Migration: Add is_pinned column + pin-aware index to conversation_participants
-- Date: 2026-05-29
-- Spec: SCHEMA_DESIGN.md (t_fddf3adc)
--
-- Changes:
--   1. Add is_pinned boolean NOT NULL DEFAULT false to conversation_participants
--   2. Drop idx_participants_user, create idx_participants_user_pinned on
--      (user_id, is_pinned DESC) WHERE deleted_at IS NULL
--
-- Zero-downtime: additive column with a default means existing rows get
-- is_pinned = false immediately. Index replacement is safe — the old index
-- is dropped only after the new one exists (in a single transaction).
--
-- Rollback: see ROLLBACK section at bottom.

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ UP ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- 1. Add is_pinned column
alter table public.conversation_participants
  add column is_pinned boolean not null default false;

comment on column public.conversation_participants.is_pinned is
  'User-level pin: pinned conversations rise to the top of the sidebar. Default false.';

-- 2. Replace idx_participants_user with a pin-aware index
--
-- The old index idx_participants_user on (user_id) WHERE deleted_at IS NULL
-- is used for "find all my active conversations". We need the same but ordered
-- so pinned rows sort first.
--
-- Since PostgreSQL partial indexes don't support ordering by the partial
-- predicate, we do the next best thing: include is_pinned DESC as the second
-- column. This allows:
--   WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_pinned DESC, ...
-- which the sidebar query will use.
--
-- We create the new index first, then drop the old one — no index gap.

create index if not exists idx_participants_user_pinned
  on public.conversation_participants (user_id, is_pinned desc)
  where deleted_at is null;

-- Drop the old index. It's no longer needed — idx_participants_user_pinned
-- covers the same queries and more.
drop index if exists public.idx_participants_user;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ ROLLBACK ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- To revert this migration, run the following SQL in a transaction:
--
-- begin;
--   create index if not exists idx_participants_user
--     on public.conversation_participants (user_id)
--     where deleted_at is null;
--   drop index if exists public.idx_participants_user_pinned;
--   alter table public.conversation_participants drop column is_pinned;
-- commit;
