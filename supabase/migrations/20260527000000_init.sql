-- =============================================================================
-- NeoMessage — Initial Schema Migration
-- Target: Supabase (PostgreSQL 15+)
-- Date:   2026-05-27
-- =============================================================================
-- Consolidated migration combining the best of both original files.
-- Run sections in order. Each section is idempotent where possible.
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Section A: Extensions & Custom Types
-- ────────────────────────────────────────────────────────────────────────────

-- pgcrypto is typically pre-enabled on Supabase, but ensure it's available
-- for gen_random_uuid() and other crypto functions.
create extension if not exists "pgcrypto" with schema extensions;

-- Extensible message type enum — add new types by altering the enum, not
-- schema migration per type.
do $$ begin
  create type public.message_type as enum (
    'text',   -- regular user message
    'system', -- system event (user joined, left, title changed)
    'image',  -- image message
    'file'    -- file attachment
  );
exception
  when duplicate_object then null;
end $$;

comment on type public.message_type is
  'Message content types. Add new values via ALTER TYPE ... ADD VALUE.';

-- ────────────────────────────────────────────────────────────────────────────
-- Section B: Core Tables
-- ────────────────────────────────────────────────────────────────────────────

-- 1. user_profiles — maps auth.users to public profile data
create table if not exists public.user_profiles (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null unique references auth.users(id)
                           on delete cascade,
  username     text        not null unique,
  display_name text        not null,
  avatar_url   text,                    -- Supabase Storage URL (public or signed)
  created_at   timestamptz not null default now(),

  constraint username_length
    check (char_length(username) >= 3 and char_length(username) <= 30),
  constraint username_format
    check (username ~ '^[a-zA-Z0-9_]+$')
);

comment on table public.user_profiles is
  'Maps auth.users to public profile data. One-to-one with auth.users.';

-- Most common fetch: lookup by auth UID on every authenticated request
create index if not exists idx_user_profiles_user_id
  on public.user_profiles (user_id);

-- Username lookup for search / mention autocomplete
create index if not exists idx_user_profiles_username
  on public.user_profiles (username);


-- 2. conversations — represents a chat (DM or group)
create table if not exists public.conversations (
  id              uuid        primary key default gen_random_uuid(),
  title           text,                    -- null for 1-on-1 (UI derives name)
  is_group        boolean     not null default false,
  created_by      uuid        references public.user_profiles(user_id)
                              on delete set null,
  last_message_at timestamptz,             -- denormalized; see trigger §D2
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz              -- soft-delete
);

comment on table public.conversations is
  'A chat conversation (DM or group). Soft-deletable.';

-- Sort recent conversations for the sidebar (most common query)
create index if not exists idx_conversations_recent
  on public.conversations (last_message_at desc nulls last)
  where deleted_at is null;

-- Find conversations created by a specific user
create index if not exists idx_conversations_created_by
  on public.conversations (created_by);


-- 3. conversation_participants — many-to-many: users ↔ conversations
create table if not exists public.conversation_participants (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.conversations(id)
                              on delete cascade,
  user_id         uuid        not null references public.user_profiles(user_id)
                              on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,             -- for unread badge tracking
  deleted_at      timestamptz,             -- per-user "hide conversation"

  constraint unique_participant
    unique (conversation_id, user_id)
);

comment on table public.conversation_participants is
  'Many-to-many: which users are in which conversations. Per-user soft-delete.';

-- Find all conversations for a user (primary sidebar query)
create index if not exists idx_participants_user
  on public.conversation_participants (user_id)
  where deleted_at is null;

-- Find a specific user's read state in a conversation (for unread count)
create index if not exists idx_participants_conversation_user
  on public.conversation_participants (conversation_id, user_id);

-- Find all participants of a conversation (for message delivery)
create index if not exists idx_participants_conversation
  on public.conversation_participants (conversation_id);


-- 4. messages — the core message table
create table if not exists public.messages (
  id              uuid               primary key default gen_random_uuid(),
  conversation_id uuid               not null references public.conversations(id)
                                      on delete cascade,
  sender_id       uuid               references public.user_profiles(user_id)
                                      on delete set null,  -- null for system messages
  type            public.message_type not null default 'text',
  content         text               not null,
  metadata        jsonb,             -- flexible: image dims, file refs, mentions
  created_at      timestamptz        not null default now(),
  updated_at      timestamptz,       -- set if message is edited (null = never edited)
  deleted_at      timestamptz        -- soft-delete
);

comment on table public.messages is
  'Messages within a conversation. Soft-deletable. Message types extensible via enum.';

-- Paginate messages in a conversation (most common query)
create index if not exists idx_messages_conversation_created
  on public.messages (conversation_id, created_at desc);

-- Active messages only (no soft-deletes), for realtime + load queries
create index if not exists idx_messages_active
  on public.messages (conversation_id, created_at desc)
  where deleted_at is null;

-- Find messages by sender (user's sent messages, profile history)
create index if not exists idx_messages_sender
  on public.messages (sender_id, created_at desc)
  where sender_id is not null;

-- Optional: BRIN index for time-range scans on very large tables (10M+ rows)
-- Uncomment when needed:
-- create index concurrently idx_messages_created_brin
--   on public.messages using brin (created_at)
--   with (pages_per_range = 32);


-- ────────────────────────────────────────────────────────────────────────────
-- Section C: Row-Level Security — Enable
-- ────────────────────────────────────────────────────────────────────────────

alter table public.user_profiles             enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;

-- ────────────────────────────────────────────────────────────────────────────
-- Section D: Row-Level Security — Policies
-- ────────────────────────────────────────────────────────────────────────────
-- All policies reference auth.uid() (Supabase Auth UUID) for consistent
-- access checks without extra joins. Semi-join patterns are used for
-- efficient index-only scans on conversation_participants.
-- ────────────────────────────────────────────────────────────────────────────

-- D1. user_profiles — anyone can read; only owner can update/insert
-- ────────────────────────────────────────────────────────────────────────────

create policy "Profiles are publicly readable"
  on public.user_profiles for select
  using (true);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Insert happens on signup (trigger)"
  on public.user_profiles for insert
  with check (user_id = auth.uid());


-- D2. conversations — only current participants can see/act
-- ────────────────────────────────────────────────────────────────────────────

create policy "Participants can view conversations"
  on public.conversations for select
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = conversations.id
        and user_id = auth.uid()
        and deleted_at is null
    )
  );

create policy "Participants can update conversation metadata"
  on public.conversations for update
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = conversations.id
        and user_id = auth.uid()
        and deleted_at is null
    )
  );

create policy "Authenticated users can create conversations"
  on public.conversations for insert
  with check (true);

create policy "Participants can soft-delete conversations"
  on public.conversations for update
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = conversations.id
        and user_id = auth.uid()
        and deleted_at is null
    )
  );


-- D3. conversation_participants — self-read + mutual visibility
-- ────────────────────────────────────────────────────────────────────────────

create policy "Participants can view who else is in their conversations"
  on public.conversation_participants for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversation_participants.conversation_id
        and cp.user_id = auth.uid()
        and cp.deleted_at is null
    )
  );

create policy "Participants can invite others to group conversations"
  on public.conversation_participants for insert
  with check (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversation_participants.conversation_id
        and cp.user_id = auth.uid()
    )
    or auth.uid() = user_id  -- user can add themselves (DM creation flow)
  );

create policy "Participants can remove themselves (soft-delete)"
  on public.conversation_participants for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- D4. messages — participants can read/insert; sender can edit/soft-delete own
-- ────────────────────────────────────────────────────────────────────────────

create policy "Participants can read messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = messages.conversation_id
        and user_id = auth.uid()
        and deleted_at is null
    )
  );

create policy "Participants can insert messages"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = messages.conversation_id
        and user_id = auth.uid()
        and deleted_at is null
    )
    and (sender_id = auth.uid() or type = 'system')
  );

create policy "Sender can edit own message"
  on public.messages for update
  using (sender_id = auth.uid() and deleted_at is null)
  with check (sender_id = auth.uid() and updated_at is not null);

create policy "Sender can soft-delete own message"
  on public.messages for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid() and deleted_at is not null);


-- ────────────────────────────────────────────────────────────────────────────
-- Section E: Functions and Triggers
-- ────────────────────────────────────────────────────────────────────────────

-- E1. Auto-create profile on signup
-- Collision-safe: retries with _N suffix, falls back to UUID fragment.
-- NOTE: If your Supabase project restricts triggers on auth.users, configure
-- this as a Supabase Auth Hook instead (Authentication → Hooks in Dashboard).
-- The function below (handle_new_user) works identically in either mode.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_username text;
  final_username text;
  counter int := 0;
begin
  -- Derive base username from email prefix
  base_username := regexp_replace(
    split_part(new.email, '@', 1),
    '[^a-zA-Z0-9_]', '_', 'g'
  );

  -- Truncate to max length (30 max - 6 for _NNNNN suffix buffer)
  base_username := left(base_username, 25);

  -- Handle collision: try base, then base_1, base_2, etc.
  loop
    final_username := case when counter = 0 then base_username
                           else base_username || '_' || counter::text end;
    begin
      insert into public.user_profiles (user_id, username, display_name)
      values (
        new.id,
        final_username,
        coalesce(nullif(split_part(new.email, '@', 1), ''), 'New User')
      );
      return new;
    exception when unique_violation then
      counter := counter + 1;
      if counter > 100 then
        -- Fallback: use a UUID fragment (extremely unlikely to collide)
        final_username := 'user_' || substr(new.id::text, 1, 8);
        insert into public.user_profiles (user_id, username, display_name)
        values (new.id, final_username, 'New User');
        return new;
      end if;
    end;
  end loop;
end;
$$;

comment on function public.handle_new_user() is
  'Auto-creates user_profiles row on auth user signup. Collision-safe retry loop.';

-- Trigger on auth.users INSERT
-- NOTE: If this trigger fails with "permission denied for schema auth",
-- use Supabase Dashboard → Authentication → Hooks instead:
--   Add a Post-registration hook pointing to public.handle_new_user().
-- This replaces the raw trigger approach.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- E2. Bump conversation timestamps on new message
create or replace function public.bump_conversation_timestamp()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.conversations
  set
    updated_at = now(),
    last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

comment on function public.bump_conversation_timestamp() is
  'Updates conversations.updated_at and last_message_at on new message insert.';

-- Trigger on messages INSERT
drop trigger if exists on_message_inserted on public.messages;
create trigger on_message_inserted
  after insert on public.messages
  for each row
  execute function public.bump_conversation_timestamp();


-- ────────────────────────────────────────────────────────────────────────────
-- Section F: Realtime
-- ────────────────────────────────────────────────────────────────────────────

-- Enable Realtime for tables clients subscribe to.
-- Keep the publication narrow — only add tables that need live updates.
-- This reduces WAL overhead on INSERT/UPDATE/DELETE.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;

-- REPLICA IDENTITY FULL ensures Realtime sends the full row on UPDATE/DELETE.
-- Acceptable for messages (mostly INSERT, occasional UPDATE); adjust if
-- the table reaches very high write volume.
alter table public.messages      replica identity full;
alter table public.conversations replica identity full;


-- ────────────────────────────────────────────────────────────────────────────
-- Section G: Storage — Avatars Bucket
-- ────────────────────────────────────────────────────────────────────────────
-- Bucket name: avatars
-- Path:        avatars/{user_id}/{filename}
-- Visibility:  Public (images rendered in profile/chat via getPublicUrl())
-- ────────────────────────────────────────────────────────────────────────────

-- Create the storage bucket (idempotent — does nothing if already exists)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,                              -- public bucket for direct URL serving
  5242880,                           -- 5 MB file size limit (matches code validation)
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- Section H: Storage — RLS Policies
-- ────────────────────────────────────────────────────────────────────────────

-- H1. Anyone can read avatars (needed to render sender avatars)
create policy "Anyone can read avatars"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

-- H2. Users can only upload their own avatar directory
create policy "Users can upload own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- H3. Users can only update/delete their own avatar
create policy "Users can manage own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- =============================================================================
-- End of migration
-- =============================================================================
