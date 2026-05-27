# NeoMessage — Supabase Schema Design

> Authored: 2026-05-27
> Target: Supabase (PostgreSQL 15+)
> Reference: `prisma/schema.prisma` (SQLite — current app schema)
> Status: Draft (ready for review)

---

## 1. Overview

This document defines the PostgreSQL schema for NeoMessage, designed for Supabase.
It maps the existing Prisma SQLite models into a Supabase-native structure, wiring
into `auth.users` for authentication, leveraging Supabase Storage for avatars, and
using Row-Level Security (RLS) for participant-based access control.

### Migration from SQLite → Supabase (PostgreSQL)

| Concern              | SQLite (current)            | PostgreSQL (Supabase)              |
|----------------------|-----------------------------|------------------------------------|
| ID type              | `cuid` (string)             | `uuid` (native via pgcrypto)       |
| Auth                 | local password hash         | `auth.users` via Supabase Auth     |
| IDs                  | `String @id @default(cuid())` | `uuid DEFAULT gen_random_uuid()` |
| Timestamps           | `DateTime`                  | `timestamptz` (TZ-aware, Realtime-friendly) |
| Indexes              | manual in schema            | B-tree + partial + BRIN for chat   |
| Access control       | app-layer middleware        | RLS on every table                 |
| Password column      | `password` stored           | ❌ removed — delegated to Supabase Auth |

### Key design decisions

1. **UUIDs everywhere** — native PostgreSQL `uuid` with `gen_random_uuid()`.
   Avoids cuid2 overhead and enables direct `auth.uid()` comparison in RLS policies.
2. **`timestamptz`** — timezone-aware throughout. Supabase stores in UTC; clients
   convert to local time. Critical for Realtime's logical replication ordering.
3. **Soft deletes** — messages use `deleted_at` (nullable). Conversations use
   soft-delete too. Hard deletes propagate via `ON DELETE CASCADE` only through
   the relationship chain, not application-driven deletes.
4. **`auth.uid()` in RLS** — all policies reference `auth.uid()` (the Supabase Auth
   UUID) to avoid joins to `user_profiles.id` in access checks. This means foreign
   keys on `sender_id` and `user_id` target `user_profiles.user_id` (which is
   `UNIQUE` and equals `auth.uid()`), keeping joins consistent with policies.

---

## 2. Table: `auth.users` (Supabase-managed)

Supabase provides this table automatically via the Auth schema. We do **not** create
it — we reference it via foreign key.

```sql
-- Reference shape (managed by Supabase):
-- auth.users (
--   id         uuid PRIMARY KEY,
--   email      text,
--   created_at timestamptz,
--   ...
-- );
```

Key columns we care about: `id` (UUID), `email`, `created_at`.

Our profile table (`user_profiles`) links 1:1 to `auth.users.id` via
`user_profiles.user_id`.

---

## 3. Table: `user_profiles`

Maps a Supabase Auth user to their NeoMessage profile. This is the public-facing
user row.

```sql
create table public.user_profiles (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null unique references auth.users(id)
                           on delete cascade,
  username     text        not null unique,
  display_name text        not null,
  avatar_url   text,                    -- Supabase Storage URL (see §9)
  created_at   timestamptz not null default now(),

  constraint username_length
    check (char_length(username) >= 3 and char_length(username) <= 30),
  constraint username_format
    check (username ~ '^[a-zA-Z0-9_]+$')
);

comment on table public.user_profiles is
  'Maps auth.users to public profile data. One-to-one with auth.users.';

-- Most common fetch: lookup by auth UID on every authenticated request
create index idx_user_profiles_user_id
  on public.user_profiles (user_id);

-- Username lookup for search / mention autocomplete
create index idx_user_profiles_username
  on public.user_profiles (username);
```

### Column notes

- `user_id` — foreign key into `auth.users`. `ON DELETE CASCADE` means if the
  auth user is deleted, the profile goes too.
- `username` — unique, alphanumeric + underscore, 3–30 chars. Used for
  @-mentions and profile URLs.
- `display_name` — separate from username, can include spaces, emoji, etc.
- `avatar_url` — nullable; points to `avatars/{user_id}/avatar.{ext}` in
  Supabase Storage (see §9).
- `id` — separate UUID from `user_id` so the profile PK is stable and not
  coupled to the auth provider. This also allows future multi-auth scenarios
  (one profile linked to multiple auth identities via a bridge table).

---

## 4. Table: `conversations`

Represents a chat conversation (group DM or 1-on-1).

```sql
create table public.conversations (
  id              uuid        primary key default gen_random_uuid(),
  title           text,                    -- null for 1-on-1 (UI derives name)
  is_group        boolean     not null default false,
  created_by      uuid        references public.user_profiles(user_id)
                              on delete set null,
  last_message_at timestamptz,             -- denormalized; see trigger §10.2
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz              -- soft-delete
);

comment on table public.conversations is
  'A chat conversation (DM or group). Soft-deletable.';

-- Sort recent conversations for the sidebar
create index idx_conversations_recent
  on public.conversations (last_message_at desc nulls last)
  where deleted_at is null;

-- Find conversations created by a specific user
create index idx_conversations_created_by
  on public.conversations (created_by);
```

### Column notes

- `is_group` — when `false`, the title may be null and the UI derives a display
  name from the other participant.
- `created_by` — tracks who created the conversation. Useful for group
  management (only the creator can change title, add/remove participants).
  `ON DELETE SET NULL` so deleting a user doesn't cascade-destroy conversations.
- `last_message_at` — denormalized timestamp set by trigger on message insert.
  Enables efficient sidebar queries without a JOIN + GROUP BY across messages.
- `updated_at` — bumped on every new message via trigger. Used as secondary
  sort for conversation lists.
- `deleted_at` — soft-delete for conversations. When a user "deletes" a
  conversation, we insert a row in `conversation_participants.deleted_at` (see §5)
  rather than hard-deleting the conversation row, so other participants can
  still access it.

---

## 5. Table: `conversation_participants`

Join table linking users to conversations.

```sql
create table public.conversation_participants (
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

-- Find all conversations for a user (the primary sidebar query)
create index idx_participants_user
  on public.conversation_participants (user_id)
  where deleted_at is null;

-- Find a specific user's read state in a conversation (for unread count)
create index idx_participants_conversation_user
  on public.conversation_participants (conversation_id, user_id);

-- Find all participants of a conversation (for message delivery)
create index idx_participants_conversation
  on public.conversation_participants (conversation_id);
```

### Column notes

- `user_id` references `user_profiles.user_id` (the auth UUID), not
  `user_profiles.id`. This keeps RLS policies consistent — `auth.uid()` works
  directly without an extra join.
- `last_read_at` enables unread-count queries:
  `SELECT count(*) FROM messages WHERE conversation_id = $1 AND created_at > $last_read_at`.
- `deleted_at` — per-participant soft-delete. When a user "leaves" or "deletes"
  a conversation, we set this timestamp rather than deleting the row. The
  participating user's sidebar query filters on `deleted_at IS NULL`, so the
  conversation disappears only for them.
- `unique_participant` prevents duplicate memberships.

---

## 6. Table: `messages`

The core message table. Heavily indexed for chat workload patterns.

```sql
create type public.message_type as enum (
  'text',          -- regular user message
  'system',        -- system event (user joined, left, title changed)
  'image',         -- image message
  'file'           -- file attachment
);

create table public.messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.conversations(id)
                              on delete cascade,
  sender_id       uuid        references public.user_profiles(user_id)
                              on delete set null,   -- nullable for system messages
  type            public.message_type not null default 'text',
  content         text        not null,
  metadata        jsonb,                   -- flexible: image dimensions, file refs, mentions
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,             -- set if message is edited
  deleted_at      timestamptz              -- soft-delete
);

comment on table public.messages is
  'Messages within a conversation. Soft-deletable. Message types extensible via enum.';

-- --- Indexes for chat workload ---

-- 1. Paginate messages in a conversation (most common query):
--    SELECT ... WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2
create index idx_messages_conversation_created
  on public.messages (conversation_id, created_at desc);

-- 2. Active messages only (no soft-deletes), used for real-time subscription
--    and "load conversation" queries
create index idx_messages_active
  on public.messages (conversation_id, created_at desc)
  where deleted_at is null;

-- 3. Find messages by sender (user's sent messages, profile history)
create index idx_messages_sender
  on public.messages (sender_id, created_at desc)
  where sender_id is not null;

-- 4. Unread count: count messages after a participant's last_read_at
--    This covers: SELECT count(*) WHERE conversation_id = $1 AND created_at > $2
--    (The conversation_id index already handles this efficiently.)
--    If unread count queries are slow, add a BRIN index on (conversation_id, created_at)
--    for very large message tables — see §11.

-- 5. BRIN index for time-range scans (alternative to B-tree for very large tables)
--    create index idx_messages_created_brin
--      on public.messages using brin (created_at)
--      with (pages_per_range = 32);
```

### Schema decisions

- **`message_type` enum** — extensible for future types (video, voice, poll).
  `sender_id` is nullable because system messages have no sender.
- **`metadata` jsonb** — flexible payload per type:
  - `image` → `{width, height, file_url, thumb_url}`
  - `file` → `{file_name, file_size, mime_type, file_url}`
  - `text` → `{mentions: [user_id, ...], reply_to: message_id}`
- **`deleted_at` instead of hard delete** — messages are soft-deleted so
  "unsend" is reversible and audit-friendly. The partial index
  `idx_messages_active` keeps active queries fast.
- **`updated_at` nullable** — only set on edit; `null` = never edited.
- **No `read_at` per message** (from old schema) — replaced by
  `last_read_at` on `conversation_participants`. More efficient: one row update
  per user per read instead of scanning thousands of messages.
- **`sender_id ON DELETE SET NULL`** — if an auth user is deleted, their
  messages remain in conversations but show as "[deleted user]". Better
  UX than cascade-deleting entire conversations.
- **Content is plain `text`** with `metadata` jsonb for rich context.

---

## 7. Row-Level Security (RLS)

Supabase enforces RLS at the database level. All tables are **locked down** —
the application never connects as `postgres` but as the authenticated user via
`auth.uid()`.

### 7.1 Enable RLS

```sql
alter table public.user_profiles             enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;
```

### 7.2 RLS Policies

#### user_profiles — anyone can read; only the owner can update

```sql
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
```

> Insert-on-signup is handled by a `handle_new_user()` trigger on `auth.users`
> — see §10. This policy exists as a safety net.

#### conversations — only participants can see/act

```sql
create policy "Participants can view conversations"
  on public.conversations for select
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = id
        and user_id = auth.uid()
        and deleted_at is null
    )
  );

create policy "Participants can update conversation metadata"
  on public.conversations for update
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = id
        and user_id = auth.uid()
        and deleted_at is null
    )
  );

create policy "Authenticated users can create conversations"
  on public.conversations for insert
  with check (true);
```

> Note: `deleted_at is null` check on participants prevents users from seeing
> conversations they've "deleted" from their sidebar.

#### conversation_participants — participants can see membership; insertion is controlled

```sql
create policy "Participants can view who else is in their conversations"
  on public.conversation_participants for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversation_id
        and cp.user_id = auth.uid()
        and cp.deleted_at is null
    )
  );

create policy "Participants can invite others to group conversations"
  on public.conversation_participants for insert
  with check (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = conversation_id
        and user_id = auth.uid()
    )
    or auth.uid() = user_id  -- user can add themselves (creating a DM)
  );

create policy "Participants can remove themselves (soft-delete)"
  on public.conversation_participants for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

> **Important fix from v0**: The insert policy now requires either:
> 1. The user is already a participant (existing member inviting someone), **or**
> 2. The user is adding themselves (DM creation flow).
>
> The old `with check (true)` policy was too permissive — any authenticated
> user could join any conversation.

#### messages — only participants can read/insert; sender can soft-delete own

```sql
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
```

> The insert policy allows `type = 'system'` messages to be inserted by the
> trigger, and regular messages only by the authenticated sender. System
> messages are inserted via `SECURITY DEFINER` triggers (see §10), so this
> is a defense-in-depth check.

---

## 8. RLS Performance Considerations

All RLS policies in this schema use semi-join patterns (`EXISTS (SELECT ...)`).
These are efficient because:

1. **`conversation_participants` is narrow** — 4 data columns + PK. The
   `idx_participants_conversation_user` index on `(conversation_id, user_id)`
   is a covering index for all RLS checks: the DB can answer
   `EXISTS (SELECT 1 FROM ... WHERE conversation_id = $1 AND user_id = auth.uid())`
   with a single index-only scan.

2. **`auth.uid()` is stable within a transaction** — PostgreSQL caches repeated
   calls, so referencing it in multiple policies in the same query is cheap.

3. **No recursion risk** — `conversation_participants` RLS policy references
   itself for the "other participants can see membership" check. This is safe
   because it's a `SELECT` policy (no write recursion), and the self-reference
   uses a table alias (`cp`) which PostgreSQL resolves correctly.

---

## 9. Avatar Storage (Supabase Storage)

Avatars live in a Supabase Storage bucket called `avatars`.

### Bucket configuration

```
Bucket name:   avatars
Public:        false (served via signed URLs or CDN)
```

### Path convention

```
avatars/{user_id}/{filename}
```

Where:
- `{user_id}` = `auth.uid()` (the auth UUID)
- `{filename}` = `avatar.{ext}` (ext = `png`, `jpg`, `jpeg`, `webp`, `gif`)

Example: `avatars/a1b2c3d4-.../avatar.webp`

### Implementation notes

1. **Upload flow**: Client uploads directly to Supabase Storage via
   `supabase.storage.from('avatars').upload()`.
2. **Signed URLs**: Avatar references stored in `user_profiles.avatar_url` are
   either short-lived signed URLs (e.g., 1 hour) or permanent public URLs if
   the bucket is made public. Use Supabase's built-in `getPublicUrl()` for
   public buckets, or `createSignedUrl()` for private.
3. **Image transformation**: Use Supabase's image transformation API via URL
   parameters (`?width=64&height=64&resize=cover`) for thumbnails.
4. **Deletion**: When `auth.users` is deleted, a Supabase Database Webhook
   triggers an Edge Function to clean up `avatars/{user_id}/`.

### RLS on Storage

```sql
-- Users can read any avatar (needed to render message sender avatars)
create policy "Anyone can read avatars"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

-- Users can only upload their own avatar
create policy "Users can upload own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can only update/delete their own avatar
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
```

> The `(storage.foldername(name))[1]` extracts the first path segment from the
> object path and compares it to the authenticated user's UUID. This prevents
> users from overwriting each other's avatars.

---

## 10. Triggers and Functions

### 10.1 Auto-create profile on signup

```sql
-- Function: creates user_profiles row when a new auth user registers
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

  -- Truncate to max length
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
        coalesce(split_part(new.email, '@', 1), 'New User')
      );
      return new;
    exception when unique_violation then
      counter := counter + 1;
      if counter > 100 then
        -- Fallback: use a UUID fragment
        final_username := 'user_' || substr(new.id::text, 1, 8);
        insert into public.user_profiles (user_id, username, display_name)
        values (new.id, final_username, 'New User');
        return new;
      end if;
    end;
  end loop;
end;
$$;

-- Trigger: fires on auth.users INSERT
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
```

> **Collision handling**: The old version used a simple `coalesce` with a basic
> fallback. This version uses a retry loop with `_N` suffixes (up to 100),
> then a UUID-fragment fallback. The retry-loop pattern is safe because the
> function is `SECURITY DEFINER` and runs in a single transaction — no race
> condition between the insert and the collision check. The function will also
> need `EXECUTE ON ALL BACKENDS` privileges or use Supabase's `handle_new_user`
> hook mechanism; for Supabase, prefer the built-in Auth Hook
> (see §10.3).

### 10.2 Bump `conversations.updated_at` & `last_message_at` on new message

```sql
-- Function: update conversation timestamps on new message
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

-- Trigger: fires on messages INSERT
create trigger on_message_inserted
  after insert on public.messages
  for each row
  execute function public.bump_conversation_timestamp();
```

> The trigger sets both `updated_at` (backward-compatibility) and
> `last_message_at` (the denormalized field used for sidebar sorting).
> Both are important: `last_message_at` is the primary sort key, while
> `updated_at` tracks other changes (title, participant changes).

### 10.3 Supabase Auth Hooks (alternative to trigger)

Supabase supports **Auth Hooks** as an alternative to raw triggers on
`auth.users`. The preferred approach:

1. Go to **Authentication → Hooks** in the Supabase Dashboard.
2. Add a **Post-registration hook** pointing to the
   `public.handle_new_user()` function.
3. This replaces the raw `CREATE TRIGGER` on `auth.users`, which may be
   restricted in some Supabase tiers.

If the trigger approach fails with `permission denied for schema auth`,
use the Supabase Dashboard hook configuration instead.

---

## 11. Realtime Considerations

Supabase Realtime broadcasts changes to subscribed clients. The schema must
support efficient subscription and broadcast.

### 11.1 Realtime publication

```sql
-- Enable Realtime for tables that clients subscribe to
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
```

> Do **not** add `user_profiles` or `conversation_participants` to the
> publication unless you need real-time profile/participant updates. Keeping
> the publication narrow reduces WAL overhead.

### 11.2 Replica identity

For Realtime to send the full row on UPDATE/DELETE, use `REPLICA IDENTITY FULL`:

```sql
alter table public.messages replica identity full;
alter table public.conversations replica identity full;
```

**Impact**: `REPLICA IDENTITY FULL` writes the entire row to the WAL on every
UPDATE/DELETE, not just the PK. For `messages` (mostly INSERT, occasional
UPDATE/DELETE for soft-delete/edit), this is acceptable. For high-volume tables,
consider `REPLICA IDENTITY DEFAULT` (PK only) and fetch the full row client-side.

### 11.3 Indexing for Realtime performance

Realtime uses logical replication slots. The `pgoutput` plugin reads WAL.
Key points:

- B-tree on PK — already covered.
- `idx_messages_active` covers the common subscription filter:
  `conversation_id=eq.$X` with no deleted messages.
- Avoid sequential scans in Realtime's snapshot query — the indexes above
  ensure index-only plans for subscription validation.

### 11.4 Client-side subscription strategy

The Next.js client subscribes per-conversation:

```ts
// Subscribe to new messages in a conversation
supabase
  .channel(`conversation:${conversationId}`)
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    },
    (payload) => handleNewMessage(payload)
  )
  .subscribe();
```

The RLS policy on `messages` (participant check) gates what gets delivered.
If the user isn't a participant, the subscription receives nothing — Supabase
evaluates RLS before broadcasting via Realtime.

### 11.5 Realtime presence (online status)

For online/offline indicators, use Supabase Realtime Presence rather than a
database table:

```ts
const channel = supabase.channel('online-users');
channel
  .on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    // state contains user_id → {online_at, ...} for all tracked users
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ online_at: new Date().toISOString() });
    }
  });
```

Presence state is ephemeral (in-memory on the Realtime server), so there's no
DB table to maintain for online status.

---

## 12. BRIN Indexes (for very large message tables)

If the `messages` table grows to millions of rows and the B-tree index on
`(conversation_id, created_at)` becomes large, consider a **BRIN** (Block Range
Index) as a companion index:

```sql
-- BRIN on created_at: ~100x smaller than equivalent B-tree
create index idx_messages_created_brin
  on public.messages using brin (created_at)
  with (pages_per_range = 32);
```

BRIN indexes are excellent for append-only/append-heavy tables where `created_at`
is monotonically increasing. The trade-off:

| Index type | Size for 10M rows | Scan speed |
|------------|-------------------|------------|
| B-tree on (conversation_id, created_at) | ~500MB | Fast for point lookups |
| BRIN on created_at | ~5MB | Fast for range scans (>1% of table) |

Use BRIN **in addition to**, not instead of, the B-tree. The B-tree handles
point lookups (single conversation); BRIN handles time-range queries
("messages from last week").

---

## 13. Migration Sequence (from SQLite Prisma)

If migrating an existing SQLite database to Supabase, follow this order:

### Phase 1: Schema creation (no data migration)

1. Run all `CREATE TABLE` statements in the Supabase SQL Editor.
2. Enable RLS.
3. Create RLS policies.
4. Create indexes.
5. Create triggers and functions.
6. Create the `avatars` bucket.
7. Add Storage RLS policies.
8. Enable Realtime publication.
9. Add the Auth Hook for `handle_new_user`.

### Phase 2: Auth migration

1. Instruct existing users to reset their passwords via Supabase Auth
   (Supabase cannot import password hashes from an unknown algorithm).
   Send a "reset password" email or provide a one-time migration flow.
2. After users re-authenticate via Supabase Auth, `auth.users` rows are
   created, and `handle_new_user()` generates new `user_profiles` rows.
3. Map old user IDs to new auth UIDs in a `migration_map` table.

### Phase 3: Data migration

```sql
-- Temporary mapping table (drop after migration)
create temp table migration_map (
  old_id   text   primary key,  -- Prisma cuid
  new_uuid uuid  not null unique
);

-- Populate with profile matches (username-based)
insert into migration_map (old_id, new_uuid)
select u.id, p.user_id
from prisma_import.users u           -- old SQLite data imported via CSV
join public.user_profiles p on p.username = u.username;

-- Migrate conversations
insert into public.conversations (id, title, created_at, updated_at)
select gen_random_uuid(), title, created_at, updated_at
from prisma_import.conversations;

-- Then map conversation IDs, participants, messages...
```

### Phase 4: Cutover

1. Update `DATABASE_URL` in deployment to point to Supabase.
2. Update auth client from Prisma/local to `supabase-js`.
3. Deploy new backend with RLS-based queries.
4. After verification, archive the SQLite database.

---

## 14. Summary: Table Mapping (SQLite → Supabase)

| SQLite (Prisma)           | Supabase (PostgreSQL)                          | Notes                                                  |
|---------------------------|------------------------------------------------|--------------------------------------------------------|
| `User`                    | `auth.users` + `user_profiles`                 | Split: auth in `auth.users`, profile in `public`       |
| `password`                | ❌ removed                                     | Supabase Auth handles authentication                   |
| `Conversation`            | `conversations`                                | Added `is_group`, `created_by`, `last_message_at`, `deleted_at` |
| `ConversationParticipant` | `conversation_participants`                    | Added `last_read_at` (unread), `deleted_at` (per-user hide) |
| `Message`                 | `messages`                                     | Added `type` enum, `metadata` jsonb, `updated_at`, `deleted_at`; removed `read_at`; `sender_id` nullable |
| —                         | RLS policies                                   | New — every table locked down via `auth.uid()`         |
| —                         | Triggers                                       | New — auto-profile, bump timestamps                    |
| —                         | Storage + avatars                              | New — `avatars` bucket with path convention + RLS      |
| —                         | Realtime                                       | New — `supabase_realtime` publication + presence       |

---

## 15. Quick-Start DDL (copy-paste)

For convenience, here is the complete DDL in a single block for copying into the
Supabase SQL Editor. Run sections in order.

### Section A: Create message type enum

```sql
create type public.message_type as enum (
  'text', 'system', 'image', 'file'
);
```

### Section B: Core tables

```sql
-- 1. user_profiles
create table public.user_profiles (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null unique references auth.users(id)
                           on delete cascade,
  username     text        not null unique,
  display_name text        not null,
  avatar_url   text,
  created_at   timestamptz not null default now(),

  constraint username_length
    check (char_length(username) >= 3 and char_length(username) <= 30),
  constraint username_format
    check (username ~ '^[a-zA-Z0-9_]+$')
);
create index idx_user_profiles_user_id
  on public.user_profiles (user_id);
create index idx_user_profiles_username
  on public.user_profiles (username);

-- 2. conversations
create table public.conversations (
  id              uuid        primary key default gen_random_uuid(),
  title           text,
  is_group        boolean     not null default false,
  created_by      uuid        references public.user_profiles(user_id)
                              on delete set null,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index idx_conversations_recent
  on public.conversations (last_message_at desc nulls last)
  where deleted_at is null;
create index idx_conversations_created_by
  on public.conversations (created_by);

-- 3. conversation_participants
create table public.conversation_participants (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.conversations(id)
                              on delete cascade,
  user_id         uuid        not null references public.user_profiles(user_id)
                              on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  deleted_at      timestamptz,

  constraint unique_participant
    unique (conversation_id, user_id)
);
create index idx_participants_user
  on public.conversation_participants (user_id)
  where deleted_at is null;
create index idx_participants_conversation_user
  on public.conversation_participants (conversation_id, user_id);
create index idx_participants_conversation
  on public.conversation_participants (conversation_id);

-- 4. messages
create table public.messages (
  id              uuid               primary key default gen_random_uuid(),
  conversation_id uuid               not null references public.conversations(id)
                                      on delete cascade,
  sender_id       uuid               references public.user_profiles(user_id)
                                      on delete set null,
  type            public.message_type not null default 'text',
  content         text               not null,
  metadata        jsonb,
  created_at      timestamptz        not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);
create index idx_messages_conversation_created
  on public.messages (conversation_id, created_at desc);
create index idx_messages_active
  on public.messages (conversation_id, created_at desc)
  where deleted_at is null;
create index idx_messages_sender
  on public.messages (sender_id, created_at desc)
  where sender_id is not null;
```

### Section C: Enable RLS

```sql
alter table public.user_profiles             enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;
```

### Section D: RLS Policies

```sql
-- user_profiles
create policy "Profiles are publicly readable"
  on public.user_profiles for select using (true);
create policy "Users can update own profile"
  on public.user_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "Insert happens on signup (trigger)"
  on public.user_profiles for insert
  with check (user_id = auth.uid());

-- conversations
create policy "Participants can view conversations"
  on public.conversations for select
  using (exists (
    select 1 from public.conversation_participants
    where conversation_id = id and user_id = auth.uid()
      and deleted_at is null
  ));
create policy "Participants can update conversation metadata"
  on public.conversations for update
  using (exists (
    select 1 from public.conversation_participants
    where conversation_id = id and user_id = auth.uid()
      and deleted_at is null
  ));
create policy "Authenticated users can create conversations"
  on public.conversations for insert
  with check (true);

-- conversation_participants
create policy "Participants can view who else is in their conversations"
  on public.conversation_participants for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversation_id
        and cp.user_id = auth.uid()
        and cp.deleted_at is null
    )
  );
create policy "Participants can invite others to group conversations"
  on public.conversation_participants for insert
  with check (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = conversation_id
        and user_id = auth.uid()
    )
    or auth.uid() = user_id
  );
create policy "Participants can remove themselves (soft-delete)"
  on public.conversation_participants for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- messages
create policy "Participants can read messages"
  on public.messages for select
  using (exists (
    select 1 from public.conversation_participants
    where conversation_id = messages.conversation_id
      and user_id = auth.uid()
      and deleted_at is null
  ));
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
```

### Section E: Triggers and Functions

```sql
-- Auto-create profile on signup
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
  base_username := regexp_replace(
    split_part(new.email, '@', 1), '[^a-zA-Z0-9_]', '_', 'g'
  );
  base_username := left(base_username, 25);
  loop
    final_username := case when counter = 0 then base_username
                           else base_username || '_' || counter::text end;
    begin
      insert into public.user_profiles (user_id, username, display_name)
      values (
        new.id,
        final_username,
        coalesce(split_part(new.email, '@', 1), 'New User')
      );
      return new;
    exception when unique_violation then
      counter := counter + 1;
      if counter > 100 then
        final_username := 'user_' || substr(new.id::text, 1, 8);
        insert into public.user_profiles (user_id, username, display_name)
        values (new.id, final_username, 'New User');
        return new;
      end if;
    end;
  end loop;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Bump conversation timestamps on new message
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

create trigger on_message_inserted
  after insert on public.messages
  for each row
  execute function public.bump_conversation_timestamp();
```

### Section F: Realtime

```sql
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
alter table public.messages replica identity full;
alter table public.conversations replica identity full;
```
