-- =============================================================================
-- NeoMessage — Chat Attachments Storage Bucket + RLS
-- Target: Supabase (PostgreSQL 15+)
-- Date:   2026-05-28
-- =============================================================================
-- Context:
--   The existing avatars bucket handles profile picture uploads. This
--   migration adds a separate bucket for message attachments — files,
--   images, and documents shared within conversations.
--
-- Bucket:     chat-attachments (private — not publicly accessible)
-- Path:       {conversation_id}/{user_id}/{filename}
-- Visibility: Private — files served via signed URLs to participants only
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Section A: Create the bucket (private, 10 MB limit, all MIME types)
-- ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  '{image/*,application/pdf,text/*,application/zip}'
)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- Section B: RLS — SELECT
-- ────────────────────────────────────────────────────────────────────────────
create policy "Participants can read chat attachments"
  on storage.objects for select
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1 from public.conversation_participants
      where conversation_id = (storage.foldername(name))[1]::uuid
        and user_id = auth.uid()
        and deleted_at is null
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Section C: RLS — INSERT (own user_id folder only)
-- ────────────────────────────────────────────────────────────────────────────
create policy "Participants can upload chat attachments"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-attachments'
    and exists (
      select 1 from public.conversation_participants
      where conversation_id = (storage.foldername(name))[1]::uuid
        and user_id = auth.uid()
        and deleted_at is null
    )
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Section D: RLS — UPDATE (own files, must remain participant)
-- ────────────────────────────────────────────────────────────────────────────
create policy "Users can update own chat attachments"
  on storage.objects for update
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.conversation_participants
      where conversation_id = (storage.foldername(name))[1]::uuid
        and user_id = auth.uid()
        and deleted_at is null
    )
  )
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.conversation_participants
      where conversation_id = (storage.foldername(name))[1]::uuid
        and user_id = auth.uid()
        and deleted_at is null
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Section E: RLS — DELETE (own files, must remain participant)
-- ────────────────────────────────────────────────────────────────────────────
create policy "Users can delete own chat attachments"
  on storage.objects for delete
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.conversation_participants
      where conversation_id = (storage.foldername(name))[1]::uuid
        and user_id = auth.uid()
        and deleted_at is null
    )
  );

-- =============================================================================
-- Security Boundary Documentation
-- =============================================================================
-- Bucket:   chat-attachments (private)
-- Path:     {conversation_id}/{user_id}/{filename}
--           Example: abc-def-123/user-uuid/photo.jpg
--
-- Access Model:
--   SELECT: Conversation participants only
--   INSERT: Participants, into own user_id folder
--   UPDATE: Sender only, while still a participant
--   DELETE: Sender only, while still a participant
-- =============================================================================
