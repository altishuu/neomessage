# NeoMessage — 5-Feature Execution Plan

Generated: 2026-05-28
Project path: /home/ivanadcan35/Documents/Projects/NextJS/neomessage
Stack: Next.js 16 (App Router) + Tailwind v4 + Supabase

---

## 1. Dependency Graph Overview

```
PHASE 1 ── Foundation (Schema + Independent Backend)
├── T1 [schema-designer]  message_reactions table + RLS + realtime
├── T2 [schema-designer]  is_pinned column on conversation_participants
├── T3 [supabase-expert]  chat-attachments storage bucket + RLS
├── T4 [frontend-engineer] use-typing-presence hook (Supabase Presence)
├── T5 [backend-engineer]  PATCH/DELETE API routes for messages
└── T6 [schema-designer]  Regenerate TypeScript types (after T1+T2)

PHASE 2 ── Backend APIs (after T1, T2, T3)
├── T7 [backend-engineer]  Reactions API routes (POST / DELETE)
├── T8 [backend-engineer]  File upload API route (multipart form)
└── T9 [backend-engineer]  Update conversations API for is_pinned

PHASE 3 ── Frontend UI (after T4, T5, T7, T8, T9)
├── T10 [frontend-engineer] Typing indicator display in header (after T4)
├── T11 [frontend-engineer] Reaction picker + display UI (after T7)
├── T12 [frontend-engineer] File dropzone + inline rendering UI (after T8)
├── T13 [frontend-engineer] Edit/Delete message bubble UI (after T5)
└── T14 [frontend-engineer] Pin toggle + sorted sidebar UI (after T9)

PHASE 4 ── Review
└── T15 [reviewer]  Full feature review + quality gate
```

---

## 2. Detailed Task Definitions

### PHASE 1 — Foundation

#### T1: message_reactions Table
| Field | Value |
|-------|-------|
| **ID** | `T1` |
| **Profile** | `schema-designer` (currently stopped — start first) |
| **Parents** | None (root) |
| **Est. effort** | Small (~30 min) |

**What:**
- Create new migration `20260528000000_message_reactions.sql`
- New table `public.message_reactions`:
  ```sql
  create table if not exists public.message_reactions (
    id           uuid        primary key default gen_random_uuid(),
    message_id   uuid        not null references public.messages(id) on delete cascade,
    user_id      uuid        not null references public.user_profiles(user_id) on delete cascade,
    reaction     text        not null,  -- single emoji char: 👍❤️😂😮
    created_at   timestamptz not null default now(),
    constraint unique_user_reaction unique (message_id, user_id, reaction)
  );
  ```
- RLS policies:
  - SELECT: participants of the parent conversation can see reactions
  - INSERT: participants can react (self-insert only, user_id = auth.uid())
  - DELETE: only reaction owner can remove their reaction
  - UPDATE: not needed (user deletes + re-inserts to change)
- Enable RLS on the table
- Add to `supabase_realtime` publication (for live reaction updates)
- Replica identity full for realtime UPDATE/DELETE identification

**Technical notes:**
- Uses the existing `conversation_participants` join pattern for RLS (semi-join through `messages.conversation_id`)
- The `unique_user_reaction` constraint allows one reaction per emoji per user per message
- Add indexes: `idx_message_reactions_message_id` on `message_id` (primary query: load all reactions for a message)

---

#### T2: is_pinned Column
| Field | Value |
|-------|-------|
| **ID** | `T2` |
| **Profile** | `schema-designer` |
| **Parents** | None (root) |
| **Est. effort** | Small (~15 min) |

**What:**
- Create migration `20260528000001_conversation_participants_pin.sql`
- Add boolean column:
  ```sql
  alter table public.conversation_participants
    add column if not exists is_pinned boolean not null default false;
  ```
- Add index for pinned ordering:
  ```sql
  create index if not exists idx_participants_pinned
    on public.conversation_participants (user_id, is_pinned desc, last_message_at desc nulls last)
    where deleted_at is null;
  ```

**Technical notes:**
- Per-participant pinning (each user pins independently)
- The composite index supports: "find all conversations for user, pinned first, then by recency"
- No RLS change needed — existing participant-level policies already cover updates to this row

---

#### T3: chat-attachments Storage Bucket
| Field | Value |
|-------|-------|
| **ID** | `T3` |
| **Profile** | `supabase-expert` (currently stopped — start first) |
| **Parents** | None (root) |
| **Est. effort** | Medium (~45 min) |

**What:**
- Create new migration for storage bucket setup (could be in same migration as T1 or separate)
- Bucket: `chat-attachments`
  ```sql
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'chat-attachments',
    'chat-attachments',
    false,  -- private bucket; access through signed URLs
    10485760,  -- 10 MB
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
          'text/plain', 'application/zip', 'application/octet-stream']::text[]
  )
  on conflict (id) do nothing;
  ```
- RLS policies on `storage.objects`:
  - SELECT: participants of the conversation that owns the file (folder = conversation_id)
  - INSERT: participants can upload to their conversation's folder
  - UPDATE: uploader can overwrite own file
  - DELETE: uploader can delete own file
- Folder structure: `chat-attachments/{conversation_id}/{user_id}/{filename}`
- Create a helper function/API for generating signed URLs

**Technical notes:**
- Bucket is private; signed URLs are used for rendering (avoid public URL enumeration)
- Allowed MIME types include common image formats plus PDF, plain text, zip archives
- 10 MB per-file limit (adjustable)
- The `storage.foldername(name)[1]` pattern extracts conversation_id for RLS checks
- A Supabase Database Function is useful: `get_signed_attachment_url(path, expires_in_secs)`

---

#### T4: use-typing-presence Hook
| Field | Value |
|-------|-------|
| **ID** | `T4` |
| **Profile** | `frontend-engineer` |
| **Parents** | None (root) — fully frontend |
| **Est. effort** | Medium (~45 min) |

**What:**
- Create `/src/lib/hooks/use-typing-presence.ts`
- Uses Supabase Realtime **Presence** (not `postgres_changes`) — this is already available on the Realtime server, no schema changes needed
- Hook API:
  ```ts
  function useTypingPresence(conversationId: string) {
    // Returns:
    //   typingUsers: string[] — user IDs of currently typing participants
    //   broadcastTyping: () => void — call this when user starts typing
    //   stopTyping: () => void — call this when user stops/sends
  }
  ```
- Uses `supabase.channel()` with `presence` tracking
- Broadcasting typing state via `channel.track({ user_id: ..., typing: true })`
- Throttle/debounce: broadcast at most once per 2 seconds to avoid spam
- Auto-cleanup: sets `typing: false` when component unmounts or after 4s of inactivity
- Track join/leave to maintain `typingUsers` set

**Technical notes:**
- File: `src/lib/hooks/use-typing-presence.ts`
- Uses `createClient()` from `@/lib/supabase/client`
- Channel name pattern: `presence:conversation:{conversationId}`
- The channel tracks presence state — no DB writes needed
- Typing timeouts: if no `broadcastTyping` call for 4 seconds, user is removed from typing list

---

#### T5: PATCH/DELETE API Routes for Messages
| Field | Value |
|-------|-------|
| **ID** | `T5` |
| **Profile** | `backend-engineer` |
| **Parents** | None (root) — schema already has `updated_at` / `deleted_at` |
| **Est. effort** | Medium (~45 min) |

**What:**
- Create `/src/app/api/messages/[id]/route.ts` with two handlers:

**PATCH** (edit message):
- Auth check: verify sender_id = auth.uid()
- Body: `{ content: string }`
- Validates non-empty content
- Sets `updated_at = now()` alongside new content
- Returns updated message object including `updatedAt`
- Soft restriction: only text-type messages editable (not system, image, file)
- Max edits: messages older than 1 hour cannot be edited

**DELETE** (soft-delete):
- Auth check: verify sender_id = auth.uid()
- Sets `deleted_at = now()`
- Does NOT actually delete the row
- Returns 204 No Content

**Technical notes:**
- New API file at `src/app/api/messages/[id]/route.ts`
- Both endpoints verify sender owns the message via `sender_id = auth.uid()`
- Fetch message first to verify it exists and isn't already soft-deleted
- The existing `messages` RLS policy allows the sender to update their own message

---

#### T6: Regenerate TypeScript Types
| Field | Value |
|-------|-------|
| **ID** | `T6` |
| **Profile** | `schema-designer` |
| **Parents** | T1, T2 |
| **Est. effort** | Small (~10 min) |

**What:**
- Regenerate type definitions after schema changes
- Run: `npx supabase gen types typescript --linked > src/lib/supabase/types.ts`
- Update the `Database` type to include the new `message_reactions` table and the updated `conversation_participants` row type

**Technical notes:**
- Run after T1 and T2 have been applied to the linked Supabase project
- If no linked project, use `--local` flag
- Verify the new types compile: `npx tsc --noEmit`

---

### PHASE 2 — Backend APIs

#### T7: Reactions API Routes
| Field | Value |
|-------|-------|
| **ID** | `T7` |
| **Profile** | `backend-engineer` |
| **Parents** | T1 (schema), T6 (types) |
| **Est. effort** | Small (~30 min) |

**What:**
- Create `/src/app/api/messages/[id]/reactions/route.ts` (or `/src/app/api/reactions/route.ts`)

**POST** (add reaction):
- Body: `{ messageId, reaction }` (reaction = single emoji string)
- Validates reaction is one of: 👍❤️😂😮 (whitelist)
- Verifys user is participant of parent conversation
- Upserts: same user+message+reaction → no-op (idempotent)
- Returns the reaction object

**DELETE** (remove reaction):
- Body or query: `{ messageId, reaction }`
- Verifies ownership (reaction.user_id = auth.uid())
- Deletes the specific reaction row
- Returns 204

**Technical notes:**
- Add `reactions` field to the message response in `GET /api/conversations/[id]/route.ts` — load reactions for each message via a join or separate query
- Alternatively, load reactions via a side API call: `GET /api/messages/[id]/reactions`
- The realtime subscription in `use-realtime-messages` should also listen for INSERT/DELETE on `message_reactions`

---

#### T8: File Upload API Route
| Field | Value |
|-------|-------|
| **ID** | `T8` |
| **Profile** | `backend-engineer` |
| **Parents** | T3 (storage bucket) |
| **Est. effort** | Medium (~45 min) |

**What:**
- Create/update file upload endpoint at `/src/app/api/messages/upload/route.ts`

**POST** (multipart form data):
- Accepts `file` (binary), `conversationId` (string)
- Validates: user is participant, file size ≤ 10MB, MIME type in allowed list
- Uploads to storage: `chat-attachments/{conversationId}/{userId}/{timestamp}-{safeFilename}`
- Generates signed URL for the file
- Inserts a `messages` row with `type='image'` or `type='file'` (based on MIME type)
- Message content = original filename
- Metadata JSON includes: `{ storagePath, mimeType, fileSize, imageWidth?, imageHeight? }`
- Returns the new Message object

**Technical notes:**
- Use `createSupabaseServerClient()` for auth check
- Use `createStorageAdminClient()` (from `src/lib/supabase/storage.ts`) for the actual upload to bypass RLS
- For images, consider extracting dimensions server-side using a library like `sharp` (or rely on client-side extraction)
- The existing avatars upload approach (`storage.ts`) provides a good reference pattern

---

#### T9: Update Conversations API for is_pinned
| Field | Value |
|-------|-------|
| **ID** | `T9` |
| **Profile** | `backend-engineer` |
| **Parents** | T2 (schema), T6 (types) |
| **Est. effort** | Small (~30 min) |

**What:**
- Update `GET /api/conversations/route.ts`:
  1. Fetch `is_pinned` alongside `last_read_at` for each participation
  2. Sort results: pinned conversations first (by `last_message_at desc`), then unpinned (by `last_message_at desc`)
  3. Include `isPinned` boolean in each conversation response object

- Update `Conversation` type in `src/lib/types.ts`:
  ```ts
  export interface Conversation {
    // ... existing fields
    isPinned?: boolean;
  }
  ```

- Optionally: add a PATCH endpoint to toggle pin state:
  - `PATCH /api/conversations/[id]/pin`
  - Body: `{ isPinned: boolean }`
  - Updates `conversation_participants.is_pinned` for current user
  - Returns updated state

**Technical notes:**
- The existing API already fetches `conversation_participants` — just add `is_pinned` to the select
- Sorting can be done in JS/TS on the server, or via a Supabase query with ordering
- The `isPinned` value is per-user, so it comes from the `participations` query, not the `conversations` query

---

### PHASE 3 — Frontend UI

#### T10: Typing Indicator Display
| Field | Value |
|-------|-------|
| **ID** | `T10` |
| **Profile** | `frontend-engineer` |
| **Parents** | T4 (presence hook) |
| **Est. effort** | Medium (~45 min) |

**What:**
- Integrate `useTypingPresence` hook in the conversation page (`src/app/chat/[conversationId]/page.tsx`)
- Wire into `MessageInput`:
  - On input change → call `broadcastTyping()`
  - On send → call `stopTyping()`
- Update `ConversationHeader` to display typing indicator:
  - Shows "Alice is typing..." when one user types
  - Shows "Alice and Bob are typing..." when two users type
  - Shows "Several people are typing..." when 3+ type
  - Hides when no one is typing
  - Debounced removal: keep showing for 1.5s after last typing signal
- Exclude current user from the displayed list

**Technical notes:**
- Modify `MessageInput` to accept optional `onTyping` / `onStopTyping` callbacks
- Modify `ConversationHeader` to accept optional `typingUserNames?: string[]`
- Use a small debounce (500ms) before sending typing=true to avoid spamming on every keystroke

---

#### T11: Reaction UI
| Field | Value |
|-------|-------|
| **ID** | `T11` |
| **Profile** | `frontend-engineer` |
| **Parents** | T7 (reactions API) |
| **Est. effort** | Medium (~60 min) |

**What:**
- Update `Message` type to include `reactions: Reaction[]`
- Update `MessageList` to render reactions below each message bubble
- Reaction display:
  - Shows a compact row of reaction emojis with count
  - e.g., `👍 2 ❤️ 1 😂 1`
  - Highlight reactions from current user (e.g., different opacity/border)
- Reaction interaction:
  - Hover/tap on a message → shows a reaction picker bar with emoji buttons (👍❤️😂😮)
  - Click emoji → POST to reactions API
  - If already reacted with that emoji → DELETE (toggle behavior)
  - Click on an existing reaction from self → remove it
- Realtime live update:
  - Update `use-realtime-messages` hook or create `use-realtime-reactions` hook
  - Subscribe to INSERT/DELETE on `message_reactions` table
  - Filter by conversation ID (but realtime filtering on message_reactions is by message_id... need to handle carefully)
  - Alternative: extend the messages channel subscription to also track reactions

**Technical notes:**
- Reactions can be loaded alongside messages in `GET /api/conversations/[id]` — add a joined query
- The reaction picker is a small floating bar that appears above/below the message bubble on click
- For realtime, the simplest approach: subscribe to `message_reactions` table changes filtered by messages in the current conversation
- Toggle semantics: if user already has 👍 on message, clicking 👍 again removes it
- Add `addReaction`, `removeReaction` functions to `api.ts`

---

#### T12: File Dropzone + Inline Rendering
| Field | Value |
|-------|-------|
| **ID** | `T12` |
| **Profile** | `frontend-engineer` |
| **Parents** | T8 (upload API) |
| **Est. effort** | Large (~90 min) |

**What:**
- Update `MessageInput`:
  - Add a paperclip/attach button next to the textarea
  - Hidden `<input type="file">` triggered by the button
  - Or: drag-and-drop zone above the input (optional enhancement)
  - File selection → immediate upload via API
  - Show upload progress indicator
  - Insert an optimistic "sending..." message placeholder
  - Show error toast on failure
- Update `MessageList` to handle `type='image'` and `type='file'`:
  - For `type='image'`:
    - Render inline image in the message bubble
    - Use signed URL for access
    - Click to zoom/expand (lightbox or new tab)
    - Show loading skeleton while image loads
  - For `type='file'`:
    - Render a file attachment card: icon, filename, size, download button
    - Use signed URL for download
- Update `api.ts`: add `uploadFile(conversationId, file)` function
- Update `Message` type: `metadata` field for `{ storagePath, mimeType, fileSize }`

**Technical notes:**
- Images are rendered using signed URLs generated by a helper function or the existing `storage.ts` pattern
- The storage bucket is private, so all access goes through signed URLs
- Consider pre-creating signed URLs in the API response when returning messages
- No separate image optimization (Next.js Image component works with URLs)
- Max file size: 10MB (enforced client-side + server-side)
- The `type` enum already has `'image'` and `'file'` — no migration needed

---

#### T13: Edit/Delete Message UI
| Field | Value |
|-------|-------|
| **ID** | `T13` |
| **Profile** | `frontend-engineer` |
| **Parents** | T5 (PATCH/DELETE API) |
| **Est. effort** | Medium (~60 min) |

**What:**
- Update `MessageList` (or extract a `MessageBubble` component):
  - Show "(edited)" indicator next to timestamp when `updatedAt !== null && updatedAt !== createdAt`
  - For soft-deleted messages (`deletedAt !== null`):
    - Replace content with italic "~$ this message has been deleted" placeholder
    - No reaction display
    - Still shows sender + timestamp (greyed out)
  - Edit action:
    - Only on own messages, only text type, only if deletedAt is null
    - UI: three-dot menu → "Edit" or double-click to enter edit mode
    - Edit mode: inline textarea replaces the content
    - Save: PATCH request → update content in state
    - Cancel: Escape or click away (restore original)
    - Time limit: messages older than 1 hour cannot be edited (disable button)
  - Delete action:
    - Only on own messages
    - UI: three-dot menu → "Delete" or swipe (mobile)
    - Confirmation: simple "Are you sure?" tooltip/alert
    - Soft delete: PATCH with deleted_at set → show placeholder
- Update `use-realtime-messages` hook:
  - Subscribe to UPDATE events too (for edits + soft-deletes)
  - On UPDATE: replace the message in state (or mark as deleted if deleted_at set)
- Update `api.ts`: add `editMessage(id, content)` and `deleteMessage(id)` functions
- Update `Message` type: add `updatedAt?: string` and `deletedAt?: string` fields

**Technical notes:**
- The existing RLS policy "Sender can edit own message" already checks `sender_id = auth.uid() and updated_at is not null`
- The `use-realtime-messages` hook currently only handles INSERT — extend the subscription with `event: "*"` (or `event: "UPDATE"`)
- The `Conversation` type response already returns message fields — need to expose `updatedAt` from the API

---

#### T14: Pin Toggle + Sort Sidebar
| Field | Value |
|-------|-------|
| **ID** | `T14` |
| **Profile** | `frontend-engineer` |
| **Parents** | T9 (pin API) |
| **Est. effort** | Medium (~45 min) |

**What:**
- Update `Sidebar` component:
  - Render a pin icon (📌 or similar) on each conversation row
  - Pin toggle:
    - Clicking the pin icon toggles pin state
    - Optimistic update: immediately flip state, then sync with API
    - API call: `PATCH /api/conversations/[id]/pin`
  - Pinned conversations appear at the top, separated visually (optional divider or subtle background)
  - Sorting: pinned first (by `last_message_at` desc), then unpinned (by `last_message_at` desc)
- Update `api.ts`: add `togglePin(conversationId, isPinned)` function
- Update `Conversation` type: add `isPinned: boolean`
- Handle realtime updates: when a conversation is updated (last_message_at changes), keep pinned ordering stable

**Technical notes:**
- The pin toggle only affects the current user's `conversation_participants` row
- No need for realtime sync on pin state (per-user setting, user triggers it)
- The pin icon should have hover state showing "Pin" / "Unpin" tooltip

---

### PHASE 4 — Review

#### T15: Full Feature Review
| Field | Value |
|-------|-------|
| **ID** | `T15` |
| **Profile** | `reviewer` |
| **Parents** | All of T10–T14 |
| **Est. effort** | Medium (~60 min) |

**What:**
- Review all schema migrations for correctness and security
- Verify RLS policies on new tables and storage buckets
- Check API routes for proper error handling and auth
- Review frontend components for type safety and edge cases
- Verify Realtime subscriptions handle connect/disconnect gracefully
- Check messaging flow end-to-end: typing → send → edit → delete → react
- Verify file upload flow: select → upload → render → download
- Verify pin toggle works and persists on reload
- Run `npx tsc --noEmit` for type checking
- Run `next build` to catch compilation errors

**Technical notes:**
- Gate: Do not merge any feature branch until all review items are green
- Gate: Each feature must have its own git branch
- Gate: No TypeScript errors allowed (`tsc --noEmit` must pass)
- Gate: No console.log / debug leftovers

---

## 3. Parallel Workstreams

```
Time ──────────────────────────────────────────────────────────────────►

        T1 (reactions schema) ──┐
                                 ├── T7 (reactions API) ──→ T11 (reactions UI)
        T2 (pin schema) ────────┤
                                 ├── T9 (pin API) ────────→ T14 (pin UI)
        T3 (storage bucket) ────┤
                                 ├── T8 (upload API) ─────→ T12 (files UI)
        T4 (typing hook) ───────┤
                                 ├── T10 (typing UI) ─────┘
        T5 (edit/delete API) ───┤
                                 ├── T13 (edit/delete UI) ─┘
        T6 (types) ─────────────┘
                                          T15 (review)
```

**Workstream A (Reactions):** T1 → T6 → T7 → T11
**Workstream B (Files):** T3 → T6 → T8 → T12
**Workstream C (Edit/Delete):** T5 → T13
**Workstream D (Pin):** T2 → T6 → T9 → T14
**Workstream E (Typing):** T4 → T10

All five workstreams can be developed in parallel after Phase 1 foundation is laid.

---

## 4. Type Changes Summary

### Shared type file: `src/lib/types.ts`

```ts
// Updated Message interface
export interface Message {
  id: string;
  content: string;
  senderId: string | null;
  sender: { id: string; username: string; avatarUrl: string | null } | null;
  type: 'text' | 'system' | 'image' | 'file';  // was optional string
  conversationId: string;
  readAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;       // NEW — for edited indicator
  deletedAt?: string | null;       // NEW — for soft-delete placeholder
  metadata?: {                     // NEW — for file/image metadata
    storagePath?: string;
    mimeType?: string;
    fileSize?: number;
    imageWidth?: number;
    imageHeight?: number;
  } | null;
  reactions?: Reaction[];          // NEW — for reaction display
}

// NEW types
export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  reaction: string;
  createdAt: string;
}

// Updated Conversation interface
export interface Conversation {
  // ... existing fields
  isPinned?: boolean;              // NEW
}
```

---

## 5. API Route Map (Final)

| Method | Route | Purpose | Feature |
|--------|-------|---------|---------|
| `GET` | `/api/conversations` | List user's conversations (sorted: pinned first) | Pin |
| `POST` | `/api/conversations` | Create new conversation | Existing |
| `GET` | `/api/conversations/[id]` | Get conversation + messages (with reactions) | Reactions |
| `PATCH` | `/api/conversations/[id]/pin` | Toggle pin state | Pin |
| `POST` | `/api/messages` | Send text message | Existing |
| `PATCH` | `/api/messages/[id]` | Edit message content | Edit/Delete |
| `DELETE` | `/api/messages/[id]` | Soft-delete message | Edit/Delete |
| `GET` | `/api/messages/[id]/reactions` | Get reactions for a message | Reactions |
| `POST` | `/api/messages/[id]/reactions` | Add reaction | Reactions |
| `DELETE` | `/api/messages/[id]/reactions` | Remove reaction | Reactions |
| `POST` | `/api/messages/upload` | Upload file/image + create message | Files |

---

## 6. Kanban Task Registration

Each task above should be created as a kanban card with the following fields:
- `title`: Feature-Specific Task Name
- `assignee`: Profile name (must match fleet list)
- `labels`: `backend`, `frontend`, `schema`, `review` as appropriate
- `depends_on`: List of task IDs this task blocks on
- `priority`: High for Phase 1 foundation tasks, Medium for Phase 2-3

Register with: `hermes kanban add --title "..." --assignee ... --labels ...`

---

## 7. Key Constraints & Gates

1. **Cross-profile writes**: The cross-profile guard will block writes to other profiles' skill/plugin directories. All work in this plan modifies only the project at `/home/ivanadcan35/Documents/Projects/NextJS/neomessage/` — no cross-profile issues.

2. **Schema idempotency**: All migrations use `create table if not exists`, `add column if not exists`, `create index if not exists`, `create policy if not exists` — safe to re-apply.

3. **Git workflow**: Each feature in its own branch:
   - `feat/typing-indicators`
   - `feat/message-reactions`
   - `feat/file-sharing`
   - `feat/edit-delete`
   - `feat/pin-conversations`

4. **Type safety**: Regenerate types (`npx supabase gen types`) after every schema migration. Run `npx tsc --noEmit` before committing.

5. **Backward compatibility**: Existing conversations continue to work during incremental rollout. New columns have defaults. New API routes don't break existing clients.

---

## 8. Execution Summary

| Phase | Tasks | Profiles Needed | Est. Total Time |
|-------|-------|-----------------|-----------------|
| Phase 1 (Foundation) | T1–T6 | schema-designer, supabase-expert, frontend-engineer, backend-engineer | ~3 hours |
| Phase 2 (Backend APIs) | T7–T9 | backend-engineer | ~2 hours |
| Phase 3 (Frontend UI) | T10–T14 | frontend-engineer | ~5 hours |
| Phase 4 (Review) | T15 | reviewer | ~1 hour |
| **Total** | **15 tasks** | **4 active profiles + 1 reviewer** | **~11 hours** |
