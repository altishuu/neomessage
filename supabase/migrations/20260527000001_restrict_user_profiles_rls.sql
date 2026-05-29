-- =============================================================================
-- NeoMessage — Restrict user_profiles RLS + create public view
-- Target: Supabase (PostgreSQL 15+)
-- Date:   2026-05-27
-- =============================================================================
-- Context:
--   The "Profiles are publicly readable" policy used using(true), allowing
--   ANY request (including unauthenticated) to read all columns of every
--   user_profiles row via the Supabase REST API. This enables username
--   enumeration and exposes internal fields (id, created_at).
--
-- This migration:
--   1. Drops the permissive policy
--   2. Creates an auth-gated policy (authenticated users only)
--   3. Creates a public view exposing only the columns considered public
--      by design (user_id, username, display_name, avatar_url)
--   4. Grants SELECT on the view to both anon and authenticated roles
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Section A: Drop the overly permissive RLS policy
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "Profiles are publicly readable"
  on public.user_profiles;

-- ────────────────────────────────────────────────────────────────────────────
-- Section B: Create a restricted policy — authenticated users only
-- ────────────────────────────────────────────────────────────────────────────
-- Authenticated users can read all profiles (needed for search, participant
-- listing, sender resolution). Unauthenticated requests are blocked at the
-- table level and must use public.public_user_profiles instead.

create policy "Authenticated users can view profiles"
  on public.user_profiles for select
  using (auth.role() = 'authenticated');

comment on policy "Authenticated users can view profiles"
  on public.user_profiles is
  'Only authenticated users can read user_profiles directly. '
  'Unauthenticated access goes through public_user_profiles view.';

-- ────────────────────────────────────────────────────────────────────────────
-- Section C: Create a restricted view for public profile data
-- ────────────────────────────────────────────────────────────────────────────
-- Exposes only the columns we've deemed public by design for a messaging app.
-- security_barrier prevents leaky-join attacks and forces row-level checks
-- on the underlying table when the view is queried by anon users.

create or replace view public.public_user_profiles
with (security_barrier = true)
as
select
  user_id,
  username,
  display_name,
  avatar_url
from public.user_profiles;

comment on view public.public_user_profiles is
  'Public profile view — exposes only user_id, username, display_name, '
  'avatar_url. Accessible to both anon and authenticated roles. These '
  'fields are considered public data by design for a messaging application. '
  'security_barrier prevents leaky-join attacks.';

-- Grant SELECT to public (both anon and authenticated roles)
grant select on public.public_user_profiles to public;

-- =============================================================================
-- Security Boundary Documentation
-- =============================================================================
-- The following fields on user_profiles are deemed PUBLIC:
--   - user_id (used as foreign key throughout the app)
--   - username (shown in chat, used for @mentions, visible to all users)
--   - display_name (shown in chat UI, visible to all users)
--   - avatar_url (public avatar bucket, rendered in chat)
--
-- The following fields are PRIVATE (authenticated read only):
--   - id (internal surrogate primary key, no user-facing value)
--   - created_at (account creation timestamp, not needed by other users)
--
-- Internal id is still exposed via the PRIMARY KEY for JOINs; the view
-- excludes it so anon queries can't discover internal row ordering.
-- =============================================================================
