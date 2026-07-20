-- Full-text search on messages.content
-- Uses PostgreSQL's built-in text search with English dictionary
-- websearch_to_tsquery supports natural-language style queries ("hello world", "foo OR bar", -exclude)

-- Create the tsvector column (generated — always stays in sync)
alter table public.messages
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(content, ''))
  ) stored;

-- GIN index for fast full-text search
create index if not exists idx_messages_search_vector
  on public.messages
  using gin (search_vector);

-- Search function: returns matching messages within a conversation
-- Usage: SELECT * FROM search_messages('conversation_id_uuid', 'search query');
-- Results are ordered by ts_rank (relevance), limited to 50.
create or replace function public.search_messages(
  conv_id uuid,
  search_query text,
  max_results int default 50
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_username text,
  sender_avatar_url text,
  type text,
  content text,
  created_at timestamptz,
  rank float4
)
language sql
stable
as $$
  select
    m.id,
    m.conversation_id,
    m.sender_id,
    up.username::text as sender_username,
    up.avatar_url::text as sender_avatar_url,
    m.type::text,
    m.content,
    m.created_at,
    ts_rank(m.search_vector, websearch_to_tsquery('english', search_query)) as rank
  from public.messages m
  left join public.user_profiles up on up.user_id = m.sender_id
  where
    m.conversation_id = conv_id
    and m.deleted_at is null
    and m.search_vector @@ websearch_to_tsquery('english', search_query)
  order by rank desc
  limit max_results;
$$;
