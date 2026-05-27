# NeoMessage Architecture Plan

> A fast, reliable, secure web messenger — built in a single session with Next.js 14+ App Router, Supabase, and Tailwind CSS.

---

## 1. Tech Stack Decisions

### Next.js 14+ App Router

**Why App Router over Pages Router:**

- **Server Components by default** — Heavy lifting (data fetching, auth checks, initial renders) happens on the server. The messenger list, conversation history, and profile data are fetched server-side, reducing client JS bundle by ~40-60%.
- **Streaming SSR with Suspense** — Chat history can stream in while the shell layout renders instantly. No blank loading screens.
- **Layout nesting** — `/chat` layout wraps all chat routes with persistent sidebar. `/login` and `/register` use a separate auth layout. Clean separation.
- **Route groups** — `(auth)` and `(chat)` route groups keep URL structure clean while sharing layouts.
- **Server Actions** — Message sending (`POST /api/messages`) can be a Server Action invoked directly from `<form>`, skipping API route boilerplate. Works beautifully with Supabase's server client.
- **Middleware** — Single file handles auth redirects for the entire app. No per-page auth wrappers needed.

**Trade-off acknowledged:** Real-time updates require client components (useEffect + Supabase Realtime channel). We isolate real-time logic into thin client wrappers, keeping everything else on the server.

### Supabase (Auth + PostgreSQL + Realtime)

**Why Supabase over alternatives (Firebase, custom backend, Convex):**

- **Auth is free and comprehensive** — Built-in signup/login/logout, session management, email/password + OAuth (Google/GitHub) out of the box. Row Level Security (RLS) ties directly to `auth.users`.
- **PostgreSQL is the right choice for messaging** — Messages are relational (sender, conversation, timestamps). Supabase gives us a full Postgres 15 instance with pg_graphql, pgcrypto (for UUIDs), and pg_stat_statements.
- **Realtime is built-in** — Supabase Realtime uses PostgreSQL replication slots to broadcast row-level changes over WebSocket. No additional infrastructure (no Redis pub/sub, no Socket.io server). Subscribe to `messages` table changes for a specific conversation — 50ms typical latency.
- **RLS is the authorization layer** — Instead of building middleware or API route guards, Postgres RLS policies enforce that a user can only read/write their own conversations. This is enforced even if someone bypasses the frontend and hits the Supabase API directly.
- **Single session approach** — We need exactly one backend: Supabase. No Express/Fastify server to deploy. The Next.js app talks to Supabase via `@supabase/supabase-js` client (browser) and `@supabase/ssr` (server).

**Trade-off acknowledged:** Supabase Realtime is at-most-once delivery by default. For a single-session MVP this is fine. For production with delivery guarantees, you'd add a `messages.delivered_at` column and implement idempotent retries.

### Tailwind CSS

**Why Tailwind:**

- **Speed** — No context switching between CSS files and components. Styling happens inline in the JSX.
- **Consistent design tokens** — We define a custom color palette (`terminal-black`, `neon-cyan`, `blood-orange`, etc.) in `tailwind.config.ts`. Every component draws from the same 10-color palette.
- **Dark-first** — Tailwind's `dark:` variant works perfectly for a dark-mode-only messenger. We design dark-first, no light mode.
- **Small bundle** — JIT compilation means zero unused CSS in production. A messenger UI has lots of hover/focus/active states; JIT only emits what's used.

**Customization strategy to avoid "generic Tailwind look":** We override nearly every default. No `bg-gray-50`, no `text-blue-600`. Instead:
- Custom color scale: `terminal-black` (#0a0a0b), `panel-gray` (#141416), `border-dim` (#2a2a2e), `accent-cyan` (#00e5ff), `accent-purple` (#a855f7), `danger-red` (#ff3b30), `success-green` (#34d399).
- Custom `font-mono` for code-like elements (timestamps, typing indicators).
- Custom animation tokens for message appears, presence pulses.

---

## 2. Feature List (MVP)

### Auth
| Feature | Details |
|---------|---------|
| Sign up | Email + password, auto-creates `profiles` row via DB trigger |
| Login | Email + password, session stored in HTTP-only cookie via `@supabase/ssr` |
| Logout | Clears session, redirects to `/login` |
| Session management | Middleware checks `supabase.auth.getSession()` on every request; redirects to `/login` if no session |
| Auth UI | Custom-built (no Supabase Auth UI). Terminal-cyber theme matches the app. |

### Conversations
| Feature | Details |
|---------|---------|
| List | Left sidebar shows all conversations for current user, ordered by `last_message_at` |
| Create | Modal or inline: search users → add → creates conversation with 1+ participants |
| Search | Filter conversations by name or participant username |
| Delete/leave | Leave conversation (removes participant, hides from list) |

### Real-time Messaging
| Feature | Details |
|---------|---------|
| Send text | Input bar → Server Action → INSERT into `messages` → Realtime broadcasts |
| Receive | Realtime subscription on conversation channel → optimistic UI update |
| Read receipts | `messages.read_at` column; updated when conversation is focused |
| Message status | Sent (optimistic) → Delivered (Realtime ack) → Read (read_at set) |

### User Search / Discovery
| Feature | Details |
|---------|---------|
| Find users | Search by username or display name |
| Start conversation | From search result → create 1:1 or group conversation |
| Profile view | Modal showing user avatar, display name, joined date |

### Online Presence
| Feature | Details |
|---------|---------|
| Presence channel | Supabase Realtime presence tracking per user |
| Indicators | Green dot on active users in conversation list and chat header |
| Last seen | "Last seen X ago" for offline users |

---

## 3. Data Model

### Entity Relationship

```
auth.users (Supabase managed)
    │
    ▼
profiles (id → auth.users.id)
    │
    ├── conversation_participants
    │       │
    │       ▼
    │   conversations
    │       │
    │       ▼
    └── messages (sender_id → profiles.id, conversation_id → conversations.id)
```

### Table Definitions

#### `profiles`
Extends `auth.users` with messenger-specific profile data.

```sql
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null,
  display_name  text not null,
  avatar_url    text,
  status        text default 'offline' check (status in ('online', 'offline', 'away')),
  last_seen_at  timestamptz default now(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Auto-create profile on user signup (DB trigger)
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Why `profiles` instead of using `auth.users` directly:**
- `auth.users` has no custom columns (username, display_name, avatar_url).
- We need `username` for user search and conversations.
- `auth.users` is in the `auth` schema, not accessible to public RLS policies without a security definer wrapper.

#### `conversations`
Represents a chat between 2+ users.

```sql
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  title           text,   -- null for 1:1 (auto-derived from participant names)
  is_group        boolean default false,
  created_at      timestamptz default now(),
  last_message_at timestamptz default now()
);
```

**Design note:** 1:1 conversations auto-derive their display title from the other participant's name. Group conversations have an explicit `title`. We avoid storing a synthetic `type` enum — `is_group` is sufficient.

#### `conversation_participants`
Join table linking users to conversations.

```sql
create table public.conversation_participants (
  conversation_id uuid references public.conversations(id) on delete cascade,
  profile_id      uuid references public.profiles(id) on delete cascade,
  joined_at       timestamptz default now(),
  last_read_at    timestamptz default now(),   -- for read tracking
  primary key (conversation_id, profile_id)
);
```

**Why not store participants as a JSON array on `conversations`?**
- Relational integrity — cascade deletes work, foreign keys are enforced.
- Efficient queries — find all conversations for a user with a btree index on `profile_id`.
- RLS is straightforward — "is this user a participant?" becomes a simple join/subquery.

#### `messages`
The core messaging table. Optimized for Realtime and read receipts.

```sql
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  sender_id       uuid references public.profiles(id) on delete set null not null,
  content         text not null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  read_at         timestamptz       -- set when first recipient reads it
);

create index idx_messages_conversation_created
  on public.messages(conversation_id, created_at desc);

create index idx_messages_sender
  on public.messages(sender_id);
```

**Why not a separate `message_status` table per-recipient?**
For MVP, we use a single `read_at` column which represents "first time ANY participant reads this message." Per-user read receipts would require a `message_reads` table. That's a post-MVP optimization.

#### `user_presence` (optional lightweight alternative to Realtime presence)
If Realtime presence proves unreliable, use a simple heartbeat table:

```sql
create table public.user_presence (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  status      text not null default 'offline' check (status in ('online', 'away', 'offline')),
  last_seen   timestamptz default now()
);

-- Update on each page navigation / activity
create index idx_user_presence_status on public.user_presence(status) where status = 'online';
```

**For MVP:** We'll try Supabase Realtime presence first. Fall back to this table if needed.

---

## 4. Folder Structure

```
neomessage/
├── .env.local                    # SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
├── .gitignore
├── next.config.ts
├── tailwind.config.ts            # Custom color palette, font-mono for terminal elements
├── tsconfig.json
├── package.json
│
├── src/
│   ├── app/                          # App Router routes
│   │   ├── layout.tsx                # Root layout (fonts, metadata, <Providers>)
│   │   ├── page.tsx                  # Redirects to /chat if authed, else /login
│   │   │
│   │   ├── (auth)/                   # Route group — no chat sidebar
│   │   │   ├── layout.tsx            # Centered auth layout (logo + form)
│   │   │   ├── login/
│   │   │   │   └── page.tsx          # Login form
│   │   │   ├── register/
│   │   │   │   └── page.tsx          # Register form
│   │   │   └── auth-callback/
│   │   │       └── page.tsx          # OAuth callback handler
│   │   │
│   │   ├── chat/                     # Route group — authenticated chat
│   │   │   ├── layout.tsx            # Sidebar + main area shell
│   │   │   ├── page.tsx              # No conversation selected (empty state)
│   │   │   └── [conversationId]/
│   │   │       └── page.tsx          # Active conversation view
│   │   │
│   │   └── api/                      # API routes (minimal — Server Actions handle most)
│   │       └── realtime/
│   │           └── route.ts          # Realtime auth endpoint (for Supabase channels)
│   │
│   ├── components/                   # Shared React components
│   │   ├── ui/                       # Primitive UI components
│   │   │   ├── avatar.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── modal.tsx
│   │   │   ├── spinner.tsx
│   │   │   └── tooltip.tsx
│   │   │
│   │   ├── auth/                     # Auth-related components
│   │   │   ├── auth-form.tsx         # Reusable auth form wrapper
│   │   │   ├── login-form.tsx
│   │   │   └── register-form.tsx
│   │   │
│   │   ├── chat/                     # Chat-specific components
│   │   │   ├── conversation-list.tsx      # Scrollable conversation list
│   │   │   ├── conversation-item.tsx      # Single conversation row
│   │   │   ├── conversation-header.tsx    # Chat header (name, presence, actions)
│   │   │   ├── message-list.tsx           # Scrollable message container
│   │   │   ├── message-bubble.tsx         # Single message (sent/received styling)
│   │   │   ├── message-input.tsx          # Text input + send button
│   │   │   ├── message-status.tsx         # Sent ✓ / Delivered ✓✓ / Read ◉ indicators
│   │   │   ├── chat-empty.tsx             # "Select a conversation" placeholder
│   │   │   ├── chat-welcome.tsx           # Welcome screen for first-time users
│   │   │   └── create-conversation.tsx    # Modal: search users → create chat
│   │   │
│   │   ├── presence/                 # Presence indicators
│   │   │   ├── presence-dot.tsx      # Green/gray dot
│   │   │   └── presence-provider.tsx # Realtime presence context
│   │   │
│   │   └── layout/                   # Layout components
│   │       ├── sidebar.tsx           # Left sidebar shell
│   │       ├── sidebar-header.tsx    # User avatar + search bar + settings
│   │       ├── main-panel.tsx        # Right panel shell
│   │       └── top-bar.tsx           # Optional top navigation
│   │
│   ├── lib/                          # Core utilities
│   │   ├── supabase/
│   │   │   ├── client.ts             # Browser Supabase client (singleton)
│   │   │   ├── server.ts             # Server Supabase client (cookie-based)
│   │   │   ├── middleware.ts         # Supabase middleware helper functions
│   │   │   └── admin.ts             # Service-role client (for triggers, admin ops)
│   │   │
│   │   ├── queries/                  # Data fetching helpers (server + client)
│   │   │   ├── conversations.ts      # CRUD for conversations
│   │   │   ├── messages.ts          # CRUD for messages
│   │   │   └── users.ts             # User search / profile queries
│   │   │
│   │   ├── actions/                  # Server Actions
│   │   │   ├── auth.ts              # signIn, signUp, signOut
│   │   │   ├── messages.ts          # sendMessage, markAsRead
│   │   │   └── conversations.ts     # createConversation, leaveConversation
│   │   │
│   │   ├── hooks/                    # React hooks
│   │   │   ├── use-realtime-messages.ts   # Subscribe to new messages
│   │   │   ├── use-realtime-presence.ts   # Subscribe to presence changes
│   │   │   ├── use-conversations.ts       # Conversation list with SSR
│   │   │   └── use-current-user.ts        # Current user context
│   │   │
│   │   └── utils/
│   │       ├── cn.ts                # clsx + tailwind-merge utility
│   │       ├── format-date.ts       # Relative timestamps ("2m ago")
│   │       └── validators.ts        # Zod schemas for form validation
│   │
│   ├── providers/                    # React context providers
│   │   ├── supabase-provider.tsx     # Supabase client context
│   │   ├── user-provider.tsx         # Current user context
│   │   └── realtime-provider.tsx     # Global Realtime channel manager
│   │
│   └── middleware.ts                 # Auth middleware (root level)
│
├── supabase/
│   ├── migrations/                   # SQL migration files
│   │   ├── 00001_profiles.sql
│   │   ├── 00002_conversations.sql
│   │   └── 00003_rls_policies.sql
│   ├── seed.sql                      # Seed data for development
│   └── config.toml                   # Supabase local config
│
├── types/
│   ├── database.ts                   # Generated Supabase types (from supabase-js)
│   ├── chat.ts                       # Conversation, Message, etc. types
│   └── auth.ts                       # Auth-related types
│
└── docs/
    └── ARCHITECTURE.md               # This file
```

**Key structural decisions:**
- `src/app/` contains ONLY route definitions. All logic lives in `src/lib/` and `src/components/`.
- Server Actions in `src/lib/actions/` — co-located by domain, not by file type. This keeps related logic together.
- Queries in `src/lib/queries/` — reusable data fetching functions used by both server components and client components.
- Components split into `ui/` (generic primitives) and domain folders (`chat/`, `auth/`, `presence/`).
- Hooks in `src/lib/hooks/` — custom React hooks that wrap Supabase Realtime and state management.

---

## 5. Component Tree

```
<RootLayout>
  <Providers>                          # SupabaseProvider + UserProvider + RealtimeProvider
    │
    ├── (auth)/layout.tsx             # Centered layout
    │   ├── <BrandLogo />
    │   └── {children}
    │       ├── <LoginForm />         # /login
    │       └── <RegisterForm />      # /register
    │
    └── chat/layout.tsx              # Sidebar + Main panel
        ├── <Sidebar>
        │   ├── <SidebarHeader>
        │   │   ├── <Avatar />       # Current user avatar
        │   │   ├── <SearchInput />  # Filter conversations / search users
        │   │   └── <NewChatButton /> → triggers <CreateConversationModal>
        │   │
        │   └── <ConversationList>    # Scrollable list, server-fetched + client-updated
        │       └── <ConversationItem> (repeated)
        │           ├── <Avatar />   # Other participant(s) avatar
        │           ├── <ConversationTitle />
        │           ├── <LastMessagePreview />
        │           ├── <Timestamp />
        │           ├── <PresenceDot />   # Green/gray indicator
        │           └── <UnreadBadge />
        │
        └── <MainPanel>
            └── {children}
                ├── page.tsx (empty state)
                │   └── <ChatEmpty />   # "Select a conversation to start messaging"
                │
                └── [conversationId]/page.tsx
                    ├── <ConversationHeader>
                    │   ├── <Avatar /> + <PresenceDot />
                    │   ├── <ParticipantName />
                    │   ├── <ParticipantStatus />  # "online" / "last seen 2m ago"
                    │   └── <ChatActions />        # info, leave
                    │
                    ├── <MessageList>           # Scrollable, auto-scrolls to bottom
                    │   └── <MessageBubble> (repeated)
                    │       ├── <SenderName />  # (only for group chats)
                    │       ├── <MessageContent />  # Rendered text
                    │       ├── <Timestamp />
                    │       └── <MessageStatus />   # Sent/Delivered/Read icons
                    │
                    └── <MessageInput>
                        ├── <TextArea />       # Auto-resizing input
                        ├── <SendButton />
                        └── <TypingIndicator />  # "User is typing..."

<CreateConversationModal>           # Portal-rendered modal
    ├── <SearchInput />             # Search all users
    ├── <SearchResults>             # Click to add participant
    │   └── <UserRow> (repeated)
    └── <CreateButton />            # Creates conversation, navigates to it
```

**State management philosophy:** No Redux or Zustand. Supabase's real-time subscriptions + React Server Components + URL state is sufficient:
- `useSWR` or plain `useState` + `useEffect` for client state that needs real-time updates (message list, presence).
- Server components for initial page load (conversation list, message history).
- URL params for active conversation selection.
- React context for current user and Supabase client instance.

---

## 6. Data Flow — Real-time Messaging

### Sending a Message (Sender's Perspective)

```
User types message + presses Enter
        │
        ▼
[Client] <MessageInput /> calls Server Action:
         sendMessage({ conversationId, content })
         │
         ├──► (1) Optimistic update: Insert message into local state
         │       with temporary ID + "sending" status
         │
         ├──► (2) Server Action runs:
         │       a. Verify auth (get session from cookie)
         │       b. Verify user is participant in conversation (RLS check)
         │       c. INSERT into messages (content, sender_id, conversation_id)
         │       d. UPDATE conversations SET last_message_at = now()
         │       e. Return new message (with real ID, created_at)
         │
         └──► (3) On success:
                 a. Replace optimistic message with real one
                 b. Update message status to "sent"
                 c. Realtime broadcasts the INSERT automatically
```

```
┌──────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Browser         │     │  Next.js Server      │     │  Supabase        │
│  (Client)        │     │  (Server Action)      │     │  (Postgres+RT)   │
├──────────────────┤     ├─────────────────────┤     ├──────────────────┤
│                  │     │                      │     │                  │
│ 1. Send msg ─────┼────►│ 2. Verify session    │     │                  │
│                  │     │ 3. Check participant  │     │                  │
│                  │     │ 4. INSERT message ────┼────►│ 5. Insert row   │
│                  │     │                      │     │ 6. UPDATE conv   │
│                  │     │ 7. Return new_msg ◄──┼─────│ last_message_at │
│                  │     │                      │     │                  │
│ 8. Apply result ◄┼─────┤                      │     │                  │
│                  │     │                      │     │ 9. Realtime      │
│                  │     │                      │     │    broadcast ────│
│                  │     │                      │     │    (via PG       │
│                  │     │                      │     │     replication) │
└──────────────────┘     └─────────────────────┘     └──────────────────┘
```

### Receiving a Message (Receiver's Perspective)

```
[Client] <MessageList /> uses use-realtime-messages(conversationId)
         │
         ├──► Subscribes to Supabase Realtime channel:
         │      supabase
         │        .channel('messages:conversation_id=<id>')
         │        .on('postgres_changes',
         │            { event: 'INSERT',
         │              schema: 'public',
         │              table: 'messages',
         │              filter: `conversation_id=eq.<id>` },
         │            (payload) => handleNewMessage(payload.new) )
         │        .subscribe()
         │
         └──► When INSERT event arrives:
                a. Payload contains full new message row
                b. Prepend/append to message list state
                c. Auto-scroll to bottom if user is at bottom
                d. Show notification badge in sidebar if not viewing
                e. Show browser notification if tab is backgrounded
```

### Read Receipts Flow

```
1. User opens conversation [conversationId]/page.tsx
2. Client component fires markAsRead(conversationId) on mount
3. Server Action updates conversation_participants.last_read_at = now()
4. Client updates message statuses locally
5. (Future) Realtime broadcasts read receipts to sender
```

### Presence Flow

```
1. On app mount, <PresenceProvider /> creates a presence channel:
     supabase.channel('presence').on('presence', ...).subscribe()
2. User's presence state tracked on the channel
3. Realtime presence broadcasts { online_at: timestamp }
4. <PresenceDot /> components subscribe to presence channel
5. On user disconnect, Realtime's presence tracking automatically
   removes them (with configurable timeout)
```

---

## 7. RLS Strategy

All tables have Row Level Security enabled. Policies are restrictive (default-deny).

### `profiles`

```sql
-- Enable RLS
alter table public.profiles enable row level security;

-- Anyone can read profiles (needed for user search, conversation display)
create policy "Profiles are readable by authenticated users"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Users can update their own profile
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Users cannot delete their profile (handled by cascade from auth.users)
-- Insert is handled by the trigger (security definer), no user policy needed
```

### `conversations`

```sql
alter table public.conversations enable row level security;

-- User can read conversations they participate in
create policy "Users can read their conversations"
  on public.conversations for select
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = id
        and profile_id = auth.uid()
    )
  );

-- Any authenticated user can create a conversation
create policy "Users can create conversations"
  on public.conversations for insert
  with check (auth.role() = 'authenticated');

-- Only participants can update (e.g., title change)
create policy "Participants can update conversation"
  on public.conversations for update
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = id
        and profile_id = auth.uid()
    )
  );
```

### `conversation_participants`

```sql
alter table public.conversation_participants enable row level security;

-- User can read participant list of conversations they're in
create policy "Participants visible to conversation members"
  on public.conversation_participants for select
  using (
    exists (
      select 1 from public.conversation_participants cp2
      where cp2.conversation_id = conversation_id
        and cp2.profile_id = auth.uid()
    )
  );

-- User can insert themselves when creating conversation
create policy "Users can add themselves to conversations"
  on public.conversation_participants for insert
  with check (profile_id = auth.uid());

-- User can update last_read_at
create policy "Users can update their own participation"
  on public.conversation_participants for update
  using (profile_id = auth.uid());

-- User can delete their own participation (leave conversation)
create policy "Users can leave conversations"
  on public.conversation_participants for delete
  using (profile_id = auth.uid());
```

### `messages`

```sql
alter table public.messages enable row level security;

-- User can read messages in conversations they participate in
create policy "Users can read messages in their conversations"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversation_participants
      where conversation_id = messages.conversation_id
        and profile_id = auth.uid()
    )
  );

-- User can send messages to conversations they participate in
create policy "Users can send messages to their conversations"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_participants
      where conversation_id = messages.conversation_id
        and profile_id = auth.uid()
    )
  );

-- Users cannot update or delete messages (MVP)
-- (Future: maybe edit within 15-min window)
```

### Summary Table

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `profiles` | All authenticated users | Trigger only (no direct) | Own profile | No |
| `conversations` | Participants only | All authenticated users | Participants | No |
| `conversation_participants` | Participants of same conversation | Self only (profile_id = auth.uid()) | Self only | Self only |
| `messages` | Participants of conversation | Sender is participant | No (MVP) | No (MVP) |

**Key principle:** No policy ever trusts `sender_id` or `conversation_id` from the client. Every policy re-verifies via a subquery on `conversation_participants` that the user is actually a participant. This prevents:
- Eavesdropping on conversations you're not in
- Sending messages as another user (spoofing sender_id)
- Adding other users to conversations without their consent (not MVP, but policy structure doesn't allow it)

---

## 8. Design Direction

### Mood & Vibe

**"Terminal-Cyber" — Not generic dark mode. Think:**

- **Primary inspiration:** Signal's clean typography + Telegram's smooth animations, filtered through a terminal/cyberpunk lens.
- **Atmosphere:** Black background (`#0a0a0b`), like looking at a dark screen in a dim room. Messages appear like terminal output — clean monospace timestamps, subtle scan-line effects on hover, a cursor-like typing indicator.
- **No neumorphism. No glassmorphism. No heavy shadows.** Flat, sharp, intentional.

### Color Palette

Defined in `tailwind.config.ts`:

```
terminal-black:  #0a0a0b    (page background)
panel-gray:      #141416    (sidebar, cards)
elevation-1:     #1c1c1f    (hovered items, input backgrounds)
elevation-2:     #252528    (borders, dividers)
text-primary:    #e8e8ea    (headings, primary text)
text-secondary:  #8b8b8e    (secondary text, timestamps)
accent-cyan:     #00e5ff    (send button, links, active indicators)
accent-purple:   #a855f7    (selected state, badges, unread count)
danger-red:      #ff3b30    (delete, leave, errors)
success-green:   #34d399    (online presence dot)
```

### Typography

- **UI text:** Inter (sans-serif, clean, highly legible at small sizes).
- **Timestamps, code elements, typing indicator:** JetBrains Mono (monospace, terminal feel).
- **Message content:** Inter, 15px, comfortable line-height (1.5).

### Layout Approach

```
┌──────────────────────────────────────────────────────┐
│ [Sidebar: 340px]           [Main Panel: flex-1]      │
│ ┌──────────────────┐      ┌────────────────────────┐│
│ │ Avatar  Search 🔍 │      │ Conversation Header     ││
│ │        ⊕         │      │ Name ● Online          ││
│ ├──────────────────┤      │                        ││
│ │ Conversations    │      │ ┌──────────────────┐   ││
│ │ ┌──────────────┐ │      │ │ Message Bubble   │   ││
│ │ │ ● Alice      │ │      │ │  Hey, how are you│   ││
│ │ │   "See you..."│ │      │ │  2:30 PM ✓✓     │   ││
│ │ │   2m ago      │ │      │ └──────────────────┘   ││
│ │ ├──────────────┤ │      │ ┌────────────────────┐ ││
│ │ │ ○ Bob        │ │      │ │ My reply          │ ││
│ │ │   "Sounds..." │ │      │ │  2:31 PM ✓        │ ││
│ │ │   5m ago      │ │      │ └────────────────────┘ ││
│ │ └──────────────┘ │      │                        ││
│ │ ...              │      │ ┌────────────────────┐ ││
│ └──────────────────┘      │ │ Input > Send       │ ││
│                            │ └────────────────────┘ ││
│                            └────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

**Key layout rules:**
- Sidebar is fixed-width 340px (can collapse on mobile).
- Main panel fills remaining width.
- No top navigation bar — the sidebar header contains user avatar + search.
- Messages align left (received) / right (sent) like iMessage/Telegram.
- Input bar is pinned to the bottom of the main panel.

### Visual Details That Make It Distinct

1. **Typing indicator** — A monospace cursor blink `▌` with "User is typing..." in terminal-green. No bouncing dots.
2. **Message send animation** — Message slides in from bottom with a subtle opacity transition. Optimistic messages have a pulsing border until confirmed by the server.
3. **Presence dot** — Not a simple circle. A `◉` character in green (online) or a dim `●` (offline). Terminal-style.
4. **Timestamps** — Monospace, secondary color. Relative ("2m ago") until you hover, then absolute ("2:30 PM").
5. **Conversation list** — No avatar images for MVP (saves storage complexity). First letter of username in a colored circle (deterministic color from hash of user ID).
6. **Scrollbar** — Thin, transparent until you hover over the scroll area.
7. **Input area** — No outline on focus. Instead, a subtle cyan bottom border pulses.
8. **Empty states** — "No messages yet" in monospace, like a terminal prompt `~$ start a conversation`.
9. **Loading state** — A terminal-style `[····]` progress indicator, not a spinning wheel.

### What We Deliberately Avoid

- No gradients (except subtle cyan-purple on hover states).
- No blur effects (`backdrop-blur`).
- No rounded corners larger than 8px (messages use 6px, sidebar has 0px).
- No emoji picker (MVP — plain text only).
- No message reactions (post-MVP).
- No rich text / markdown in messages (post-MVP).

---

## 9. Route Design

### App Router Routes

| Route | Type | Layout | Description |
|-------|------|--------|-------------|
| `/` | Page | Root | Redirect: if authed → `/chat`, else → `/login` |
| `/login` | Page | `(auth)` | Email + password login form |
| `/register` | Page | `(auth)` | Sign up form (email + password + username) |
| `/auth/callback` | Page | `(auth)` | OAuth callback — exchanges code for session |
| `/chat` | Page | `(chat)` | Main chat page (no conversation selected) |
| `/chat/[conversationId]` | Page | `(chat)` | Active conversation view |
| `/api/realtime` | Route | — | Realtime auth endpoint for Supabase channels |

### Middleware Logic (`src/middleware.ts`)

```
Request comes in
    │
    ├──► path matches /login, /register, /auth/callback?
    │       └── Yes → if session exists, redirect to /chat
    │       └── No → continue
    │
    ├──► path starts with /chat or /api?
    │       └── Yes → check session
    │       │       ├── Session valid? → continue
    │       │       └── No session? → redirect to /login
    │       └── No → continue (static files, etc.)
    │
    └──► Continue to route handler
```

### Navigation Flow

```
/ (redirect)
    │
    ├── (not authed) → /login
    │                    ├──→ /register (switch to sign up)
    │                    └──→ /auth/callback (OAuth flow)
    │
    └── (authed) → /chat
                     ├──→ /chat/[conversationId] (select conversation)
                     ├──→ /chat (empty state, no conversation)
                     └──→ /login?logout=true (explicit logout)
```

---

## 10. Implementation Order

Build order is designed to produce a working, testable product at each milestone. Each step depends on the previous ones.

### Phase 0 — Project Initialization (15 min)
```
Dependencies: none
```
1. `npx create-next-app@latest neomessage --typescript --tailwind --app --src-dir`
2. Install deps: `npm install @supabase/supabase-js @supabase/ssr clsx tailwind-merge zod date-fns`
3. Dev deps: `npm install -D @types/node prettier prettier-plugin-tailwindcss`
4. Set up `tailwind.config.ts` with custom color palette
5. Create `.env.local` with Supabase project credentials
6. Set up `supabase/` local config (if using local Supabase via CLI)

**Deliverable:** Running Next.js dev server with dark background, custom fonts, no visible default Tailwind.

### Phase 1 — Auth Foundation (30 min)
```
Dependencies: Phase 0
Team: schema-designer + supabase-expert
```
1. Create `profiles` table migration (with auto-create trigger)
2. Set up `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`
3. Set up `src/lib/supabase/middleware.ts` and `src/middleware.ts`
4. Build `src/lib/actions/auth.ts` (signUp, signIn, signOut)
5. Build `src/app/(auth)/login/page.tsx` and `register/page.tsx` with custom AuthForm component
6. Build `src/app/(auth)/layout.tsx` (centered, terminal-branded)
7. Test: sign up, log in, log out, session persistence

**Deliverable:** Working auth flow. Can create account and see redirect to `/chat` (which shows a simple "Chat coming soon" page).

### Phase 2 — Data Layer (45 min)
```
Dependencies: Phase 1
Team: schema-designer + supabase-expert + backend-engineer
```
1. Create `conversations`, `conversation_participants`, `messages` tables (migrations)
2. Apply all RLS policies
3. Generate/update TypeScript types (`types/database.ts`)
4. Build `src/lib/queries/conversations.ts`, `messages.ts`, `users.ts`
5. Build `src/lib/actions/conversations.ts` (createConversation)
6. Build `src/lib/actions/messages.ts` (sendMessage)
7. Create seed data for development (2-3 test users with conversations)

**Deliverable:** Database schema is complete. Can create conversations and insert messages via Server Actions. RLS prevents unauthorized access.

### Phase 3 — Chat Layout & Sidebar (45 min)
```
Dependencies: Phase 2
Team: frontend-engineer
```
1. Build `src/app/(chat)/layout.tsx` — sidebar + main panel structure
2. Build `src/components/layout/sidebar.tsx` and `sidebar-header.tsx`
3. Build `src/components/chat/conversation-list.tsx` and `conversation-item.tsx`
4. Build `src/components/chat/chat-empty.tsx` (no-conversation state)
5. Style everything with the terminal-cyber palette
6. Build `src/components/ui/` primitives: avatar, badge, input, button, spinner

**Deliverable:** Navigate to `/chat`, see conversation list in sidebar. Clicking items shows `[conversationId]` in URL but main area still shows placeholder.

### Phase 4 — Message UI (60 min)
```
Dependencies: Phase 3
Team: frontend-engineer
```
1. Build `src/components/chat/message-bubble.tsx` — sent (right, accent) vs received (left, subtle)
2. Build `src/components/chat/message-list.tsx` — scrollable container with auto-scroll
3. Build `src/components/chat/message-input.tsx` — textarea + send button
4. Build `src/components/chat/message-status.tsx` — sent/delivered/read indicators
5. Build `src/components/chat/conversation-header.tsx` — participant name + presence
6. Build `src/app/chat/[conversationId]/page.tsx` — server component fetching messages

**Deliverable:** Can view conversation history. Can type and send messages (page refreshes to show new message). Looks like a real messenger.

### Phase 5 — Real-time Messaging (45 min)
```
Dependencies: Phase 4
Team: frontend-engineer + backend-engineer
```
1. Build `src/lib/hooks/use-realtime-messages.ts` — subscribe to INSERT on messages table
2. Integrate into `message-list.tsx` — new messages appear without page refresh
3. Build optimistic update in `message-input.tsx` — message appears instantly, then confirms
4. Set up `src/app/api/realtime/route.ts` for Realtime channel auth
5. Test: open two browser tabs as different users, send message, see it appear in real-time

**Deliverable:** Real-time messaging works. Messages flow from sender → Server Action → DB → Realtime broadcast → receiver's browser within ~100ms.

### Phase 6 — Presence & Read Receipts (30 min)
```
Dependencies: Phase 5
Team: frontend-engineer
```
1. Build `src/providers/realtime-provider.tsx` — global presence channel
2. Build `src/components/presence/presence-dot.tsx` — online indicator
3. Build `src/lib/hooks/use-realtime-presence.ts`
4. Add `markAsRead` Server Action — updates `last_read_at` on conversation focus
5. Wire read receipts into message status component

**Deliverable:** Green presence dots on online users. Read receipts update when recipient opens conversation.

### Phase 7 — User Search & Conversation Creation (30 min)
```
Dependencies: Phase 5
Team: frontend-engineer
```
1. Build `src/components/chat/create-conversation.tsx` — modal with search
2. Build user search Server Action (`src/lib/actions/users.ts`)
3. Wire up sidebar search to filter conversations
4. Test: search user → create 1:1 conversation → send first message

**Deliverable:** End-to-end flow: sign up → search for user → create conversation → send/receive messages in real-time.

### Phase 8 — Polish & Edge Cases (30 min)
```
Dependencies: Phase 7
Team: reviewer + frontend-engineer
```
1. Error states (failed send, network offline)
2. Loading states (skeleton conversation list)
3. Empty states (no conversations, no messages)
4. Responsive sidebar (mobile: toggle sidebar overlay)
5. Last seen formatting ("2m ago", "yesterday")
6. Conversation list ordering by `last_message_at`
7. Keyboard shortcuts (Enter to send, Shift+Enter for newline)
8. Browser tab title updates (unread count)

**Deliverable:** Production-quality MVP.

---

## Build Order Dependency Graph

```
Phase 0: Init
    │
    ▼
Phase 1: Auth ◄──────┐
    │                  │
    ▼                  │
Phase 2: Data Layer   │ (parallel: can do Phase 0→1 and 0→2
    │                  │  independently with schema-designer +
    ▼                  │  supabase-expert working concurrently)
Phase 3: Layout ──────┘
    │
    ▼
Phase 4: Message UI
    │
    ▼
Phase 5: Real-time
    │
    ├────────────────┐
    ▼                ▼
Phase 6: Presence  Phase 7: User Search
    │                │
    └────────────────┘
           │
           ▼
      Phase 8: Polish
```

**Parallelization strategy (if using team profiles):**

| Workstream | Who | Phases |
|-----------|-----|--------|
| Schema & Database | schema-designer + supabase-expert | 0, 2 (can start immediately) |
| Auth | backend-engineer | 1 (after Phase 0) |
| Frontend | frontend-engineer | 3, 4 (after Phase 1-2) |
| Real-time | backend-engineer + frontend-engineer | 5 (after Phase 4) |
| Presence & Search | frontend-engineer | 6, 7 (after Phase 5) |
| Review & Polish | reviewer | 8 (after Phase 7) |

**Single-session estimate:** 4-5 hours total for a single developer. With 2-3 people working in parallel (schema + backend vs frontend), 2.5-3 hours.

---

## Appendix: Key Files to Create First

### `src/lib/supabase/client.ts`
```ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

### `src/lib/supabase/server.ts`
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set(name: string, value: string, options: any) { cookieStore.set(name, value, options) },
        remove(name: string, options: any) { cookieStore.delete(name, options) },
      },
    },
  )
}
```

### `src/lib/utils/cn.ts`
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

*This architecture plan is designed for a focused single-session build. Every decision prioritizes speed-to-working-product over theoretical purity. When in doubt between "correct" and "working," choose "working" — the architecture is simple enough that refactoring later is cheap.*
