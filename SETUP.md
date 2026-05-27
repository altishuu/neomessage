# NeoMessage — Setup Guide

## Prerequisites

- Node.js 18+ (20+ recommended)
- npm / pnpm / yarn / bun
- A [Supabase](https://supabase.com) account (free tier is fine)

---

## 1. Create a Supabase Project

1. Go to [supabase.com/dashboard/projects](https://supabase.com/dashboard/projects)
2. Click **New project**
3. Set **Name** to `neomessage` (or whatever you like)
4. Set a strong **Database password** — save it somewhere
5. Choose a **Region** close to your users
6. Click **Create new project**

> Wait ~2 minutes for the database to provision.

---

## 2. Get Your Project Credentials

From the Supabase Dashboard → **Project Settings** → **API**:

| Setting | Where to find it |
|---------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | **Project URL** (e.g. `https://abc123.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **anon public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key (keep secret, server-side only) |

Copy these — you'll need them in step 6.

---

## 3. Run the Database Schema

Open the Supabase Dashboard → **SQL Editor** and run the DDL from [`docs/supabase-schema.md`](docs/supabase-schema.md).

Run these sections **in order**:

| Order | Section | What it creates |
|-------|---------|-----------------|
| 1 | **Section A** | `message_type` enum |
| 2 | **Section B** | Core tables: `user_profiles`, `conversations`, `conversation_participants`, `messages` + indexes |
| 3 | **Section C** | Enable RLS on all tables |
| 4 | **Section D** | RLS policies for every table |
| 5 | **Section E** | Triggers: auto-create profile on signup, bump conversation timestamps |
| 6 | **Section F** | Realtime publication + replica identity |

Alternatively, copy-paste the complete Quick-Start DDL block from `docs/supabase-schema.md` (sections A through F) into the SQL Editor and run them sequentially.

### Verify

After running, check the **Table Editor** in the Supabase Dashboard. You should see:

- `user_profiles`
- `conversations`
- `conversation_participants`
- `messages`

Each should have RLS enabled (shown as a shield icon next to the table name).

---

## 4. Enable Realtime

Supabase Realtime is how messages arrive in the browser without polling.

1. In the Supabase Dashboard, go to **Database → Replication**
2. Under **Publication**, you should see `supabase_realtime`
3. Verify it includes the `messages` and `conversations` tables
4. If they're missing, run the SQL from Section F in the SQL Editor again:

```sql
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
```

> **Do not** add `user_profiles` or `conversation_participants` to the publication unless you need real-time profile/participant updates. Keeping the publication narrow reduces WAL overhead.

---

## 5. Configure Auth Hook (Auto-Create Profile)

When a new user signs up, a database trigger creates their `user_profiles` row automatically.

### Option A: Supabase Auth Hook (recommended)

1. Go to **Authentication → Hooks** in the Supabase Dashboard
2. Click **Add a hook**
3. Select **Type:** `Post-registration`
4. Set **Function:** `public.handle_new_user`
5. Click **Create**

### Option B: Raw trigger (alternative)

The trigger from Section E of the schema DDL should already be in place if you ran the full DDL. You can verify in the SQL Editor:

```sql
select * from information_schema.triggers
where event_object_table = 'users'
  and trigger_schema = 'auth';
```

If the trigger or function is missing, re-run Section E.

---

## 6. Configure Environment Variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with the credentials from step 2:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

> `SUPABASE_SERVICE_ROLE_KEY` is optional for local dev but needed for storage uploads and admin operations. Keep it out of client-side code — Next.js only exposes `NEXT_PUBLIC_*` vars to the browser.

---

## 7. (Optional) Create the Avatars Storage Bucket

If you want avatar uploads, create the storage bucket:

1. Supabase Dashboard → **Storage → Buckets → Create bucket**
2. Name: `avatars`
3. Public: **off** (avatars are served via signed URLs)
4. Click **Create bucket**

Then run the Storage RLS policies from Section §9 of `docs/supabase-schema.md` in the SQL Editor.

---

## 8. Install & Run

```bash
# Install dependencies
npm install

# (Or with your preferred package manager)
pnpm install
# yarn install
# bun install

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should see the login page. Sign up a new account — it creates a profile automatically and redirects to the chat UI.

---

## Troubleshooting

### "Failed to fetch" or CORS errors

Make sure your Supabase project's authentication settings allow your local origin:

1. Supabase Dashboard → **Authentication → Providers**
2. Under **Settings**, add `http://localhost:3000` to the **Site URL** and **Additional redirect URLs**

### RLS errors when sending messages

Check that RLS policies are applied. In the SQL Editor, run:

```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

If any tables are missing policies, re-run Section D of the DDL.

### "relation does not exist"

You probably skipped one of the DDL sections. Re-run sections A through E in order.
