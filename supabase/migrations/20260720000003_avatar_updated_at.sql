-- =============================================================================
-- NeoMessage — Add avatar_updated_at to user_profiles
-- Target: Supabase (PostgreSQL 15+)
-- Date:   2026-07-21
-- =============================================================================
-- Context:
--   The avatar_url in user_profiles points to a Supabase Storage URL. Browser
--   caches may serve stale images when the avatar changes. This migration adds
--   avatar_updated_at so the frontend can append ?t=<timestamp> to avatar URLs
--   for cache-busting.
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Section A: Add avatar_updated_at column
-- ────────────────────────────────────────────────────────────────────────────

alter table public.user_profiles
  add column if not exists avatar_updated_at timestamptz;

comment on column public.user_profiles.avatar_updated_at is
  'Timestamp of the last avatar upload. Used for browser cache-busting.';

-- ────────────────────────────────────────────────────────────────────────────
-- Section B: Backfill existing avatars
-- ────────────────────────────────────────────────────────────────────────────
-- For profiles that already have an avatar_url set, use created_at as the
-- initial avatar_updated_at so existing avatars get a stable cache key.

update public.user_profiles
set avatar_updated_at = created_at
where avatar_url is not null
  and avatar_updated_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- Section C: Update public_user_profiles view to include avatar_updated_at
-- ────────────────────────────────────────────────────────────────────────────
-- The cache-busting timestamp is a necessary companion to avatar_url, which is
-- already public. It conveys no private information on its own.

create or replace view public.public_user_profiles
with (security_barrier = true)
as
select
  user_id,
  username,
  display_name,
  avatar_url,
  avatar_updated_at
from public.user_profiles;

comment on view public.public_user_profiles is
  'Public profile view — exposes user_id, username, display_name, avatar_url, '
  'avatar_updated_at. Accessible to both anon and authenticated roles. '
  'security_barrier prevents leaky-join attacks.';

-- =============================================================================
-- End of migration
-- =============================================================================
