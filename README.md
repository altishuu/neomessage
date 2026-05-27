# NeoMessage

A fast, reliable, secure web messenger — built with Next.js 16, Supabase, and Tailwind CSS.

Real-time messaging with per-conversation subscriptions, online presence indicators, and Row-Level Security baked in at the database layer.

## Tech Stack

| Layer | Choice |
|-------|--------|
| **Framework** | Next.js 16 (App Router) |
| **Auth** | Supabase Auth (email/password + OAuth) |
| **Database** | Supabase PostgreSQL 15+ |
| **Real-time** | Supabase Realtime (WAL-based broadcast) |
| **Styling** | Tailwind CSS v4 |
| **Language** | TypeScript (strict) |
| **Validation** | Zod |
| **Fonts** | Inter (UI) + JetBrains Mono (timestamps, code) |

## Features

- **Auth** — Sign up, login, logout, session management via `@supabase/ssr` HTTP-only cookies
- **Conversations** — 1-on-1 and group chats with participant management
- **Real-time messaging** — Messages delivered via Supabase Realtime subscriptions (~50ms latency)
- **Online presence** — Realtime Presence tracking per user
- **Soft deletes** — Messages and conversations soft-deleted (audit-friendly)
- **Row-Level Security** — Every table locked down via RLS policies tied to `auth.uid()`

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full plan: data model, component tree, data flow diagrams, RLS strategy, and build order.

## Schema

The Supabase schema (DDL, RLS policies, triggers, Realtime config) is documented in [docs/supabase-schema.md](docs/supabase-schema.md).

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Edit .env.local with your Supabase project credentials

# Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Project Structure

```
src/
├── app/              # App Router routes
│   ├── (auth)/       # Login, register
│   └── (chat)/       # Main chat UI
├── components/       # React components
│   ├── ui/           # Primitives (button, input, avatar, etc.)
│   ├── auth/         # Auth forms
│   ├── chat/         # Conversation list, message bubbles, input
│   └── presence/     # Online presence indicators
├── lib/
│   ├── supabase/     # Client, server, middleware, admin helpers
│   ├── queries/      # Data fetching (conversations, messages, users)
│   ├── actions/      # Server Actions (auth, messages, conversations)
│   ├── hooks/        # React hooks (real-time subscriptions)
│   └── utils/        # cn(), format-date, validators
├── providers/        # React context (Supabase, user, real-time)
└── middleware.ts     # Auth redirect middleware
```

## Env Vars

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Service role key (admin ops, storage) |

## Deploy on Vercel

The easiest way to deploy is the [Vercel Platform](https://vercel.com/new). Set the environment variables above in your Vercel project settings.
