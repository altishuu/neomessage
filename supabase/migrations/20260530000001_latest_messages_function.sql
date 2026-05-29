-- Migration: Add get_latest_messages function (DISTINCT ON per conversation)
-- Date: 2026-05-30
--
-- Returns the single most recent (non-deleted) message for each conversation
-- in a given set of conversation IDs. Useful for sidebar previews, notifications,
-- and any "latest message" display.
--
-- Language: SQL (not PL/pgSQL) for maximum inlining / optimisation.
--
-- Rollback: drop function if exists public.get_latest_messages(uuid[]);

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ UP ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

create or replace function public.get_latest_messages(conv_ids uuid[])
returns table (
  id              uuid,
  content         text,
  sender_id       uuid,
  conversation_id uuid,
  created_at      timestamptz
)
language sql
stable
as $$
  select distinct on (m.conversation_id)
    m.id,
    m.content,
    m.sender_id,
    m.conversation_id,
    m.created_at
  from public.messages m
  where m.conversation_id = any(conv_ids)
    and m.deleted_at is null
  order by m.conversation_id, m.created_at desc;
$$;

comment on function public.get_latest_messages(uuid[]) is
  'Returns the latest non-deleted message per conversation for the given conversation IDs.';

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ ROLLBACK ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- To revert this migration, run:
--   drop function if exists public.get_latest_messages(uuid[]);
