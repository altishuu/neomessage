-- Unread count function: returns # of messages after user's last_read_at
-- for each conversation the user participates in.
create or replace function public.get_unread_counts(
  p_user_id uuid
)
returns table (
  conversation_id uuid,
  unread_count bigint
)
language sql
stable
as $$
  select
    cp.conversation_id,
    count(m.id)::bigint as unread_count
  from public.conversation_participants cp
  left join public.messages m
    on m.conversation_id = cp.conversation_id
    and m.deleted_at is null
    and m.sender_id != cp.user_id  -- don't count own messages
    and (cp.last_read_at is null or m.created_at > cp.last_read_at)
  where
    cp.user_id = p_user_id
    and cp.deleted_at is null
  group by cp.conversation_id
  having count(m.id) > 0;
$$;
