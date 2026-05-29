# Security Risk Assessment: Public RLS on `user_profiles`

**Date:** 2026-05-28  
**Auditor:** Architecture reviewer pipeline  
**Severity:** Medium  
**Status:** Remediated  

---

## 1. Summary

The `user_profiles` table had an RLS policy (`"Profiles are publicly readable"`) using `using (true)`, which allowed **any request** — including unauthenticated/anonymous users — to read all columns of every user profile via the Supabase REST API.

While a messaging application necessarily exposes some profile data (usernames, display names, avatars), the `using (true)` policy was broader than necessary, enabling username enumeration and exposing internal fields (`id` surrogate key, `created_at` timestamp) to anonymous visitors.

---

## 2. Risk Analysis

### Threat: Username Enumeration

| Vector | Impact |
|---|---|
| Direct Supabase REST API query (`/rest/v1/user_profiles`) | Unauthenticated user can list all usernames, display names, and avatar URLs |
| Application API (`/api/users/search?q=...`) | Route handler checks auth first — mitigated by application-layer guard |
| Automated scraping | Without rate limiting, a bot could extract the entire user directory |

### Data Exposure

**Fields exposed to anonymous users under old policy:**

| Column | Sensitivity | Notes |
|---|---|---|
| `id` (internal UUID PK) | **Private** | Internal surrogate key, no user-facing use |
| `user_id` | **Public by design** | Maps to `auth.users.id`, used as FK throughout app |
| `username` | **Public by design** | Shown in chat, @mentions, search results |
| `display_name` | **Public by design** | Shown in chat UI |
| `avatar_url` | **Public by design** | Avatar bucket is already public |
| `created_at` | **Private** | Account creation timestamp, not needed by other users |

---

## 3. Remediation Applied

### Migration: `20260527000001_restrict_user_profiles_rls.sql`

1. **Dropped** the permissive `"Profiles are publicly readable"` policy  
2. **Created** `"Authenticated users can view profiles"` policy — only authenticated users can SELECT from `user_profiles` directly  
3. **Created** `public.public_user_profiles` view with `security_barrier = true`:
   - Exposes only: `user_id`, `username`, `display_name`, `avatar_url`
   - Excludes: `id` (internal PK), `created_at`
   - `security_barrier` prevents leaky-join attacks
4. **Granted** `SELECT on public.public_user_profiles to public` — both anon and authenticated roles can use the view

### Application-Layer Changes

| Endpoint | Change |
|---|---|
| `/api/users/search` | Rate limiting added (30 req/min per IP) to prevent automated scraping |
| `/api/profile/[id]` | Switched from `user_profiles` to `public_user_profiles` view; removed `created_at` (private) from response |

---

## 4. Security Boundary

| Role | Can access | Cannot access |
|---|---|---|
| Anonymous / Unauthenticated | `public_user_profiles` view (user_id, username, display_name, avatar_url) | `user_profiles` table directly |
| Authenticated user | Full `user_profiles` table (all columns) | N/A |
| Service role (server-side) | Full `user_profiles` table (bypasses RLS) | N/A |

### Design Decisions

- **Usernames are public**: Required for @mention resolution, search, and DM creation. An attacker knowing a username does not grant access to messages or conversations.
- **Display names are public**: Visible in every chat message. Hiding them would break the core UX.
- **Avatar URLs are public**: The avatars bucket is public. The URL alone provides no auth capabilities.
- **created_at is private**: Account creation timestamps aid reconnaissance (e.g., knowing when a user joined allows correlation with signup events).
- **id (internal PK) is private**: The UUID surrogate key provides no user-facing value and could leak table ordering.

---

## 5. Remaining Risks & Recommendations

### Low: Profile enumeration via brute-force search

Authenticated users can still enumerate usernames by searching — this is unavoidable in a messaging app where user search is a core feature. Mitigated by:

- Rate limiting on `/api/users/search` (30 req/min/IP)
- Search requires minimum 2-character query
- Results are limited to 20 users per query

### Future: Database-backed rate limiting

The current rate limiter is in-memory (per-process). For horizontally scaled deployments, consider:

- Using `@upstash/ratelimit` with Redis for distributed rate limiting
- Or implementing a database-backed rate limiter using Supabase

### Informational: Storage bucket vs RLS

The `avatars` storage bucket is public (bucket-level). This is intentional — avatars need to render in chat for all users including anonymous page loads. The RLS policy on storage objects is bucket-scoped, not column-restricted, so this is consistent with the design.

---

## 6. Verification

- [x] Migration `20260527000001` correctly drops old policy and creates auth-gated policy
- [x] Public view created with `security_barrier = true`
- [x] Search endpoint requires authentication (unchanged — already enforced)
- [x] Rate limiting added to search endpoint (30 req/min/IP)
- [x] `/api/profile/[id]` switched to `public_user_profiles` view, `created_at` removed from response
- [x] Build passes with 0 TypeScript errors
- [x] Registration endpoint uses `public_user_profiles` for anon username checks (already done)
