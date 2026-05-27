#!/usr/bin/env bash
# =============================================================================
# NeoMessage — Deployment Automation Script
# =============================================================================
# Idempotent deploy script for NeoMessage with Supabase + Vercel.
#
# Prerequisites:
#   1. A Supabase project (create at https://supabase.com/dashboard)
#   2. A Vercel account (create at https://vercel.com)
#   3. Supabase CLI installed: https://supabase.com/docs/guides/cli
#   4. Vercel CLI installed: npm i -g vercel
#
# Required environment variables:
#   SUPABASE_ACCESS_TOKEN  — Supabase management token
#   SUPABASE_PROJECT_ID    — Supabase project ref (e.g. "abcxyz...")
#   SUPABASE_DB_PASSWORD   — Database password for the Supabase project
#
# Run:
#   ./scripts/deploy.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> NeoMessage Deployment Script"
echo "    Project: $PROJECT_DIR"
echo ""

# ── Step 1: Validation ──────────────────────────────────────────────────────
echo "━━━ Step 1: Validating prerequisites ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check required tools
MISSING=""
for cmd in node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  [FAIL] $cmd not found. Install it first."
    MISSING+=" $cmd"
  fi
done

if [ -n "$MISSING" ]; then
  echo "  Missing tools:$MISSING"
  exit 1
fi

echo "  [OK] Node.js $(node -v), npm $(npm -v)"

# Check Supabase CLI (optional — we can also use the Management API via curl)
SUPABASE_CLI=false
if command -v supabase &>/dev/null; then
  SUPABASE_CLI=true
  echo "  [OK] supabase CLI $(supabase --version 2>/dev/null || echo 'present')"
else
  echo "  [WARN] supabase CLI not installed. Migrations will need manual application."
  echo "         Install: npm install -g supabase"
fi

# Check Vercel CLI (optional — deploy can be triggered via git push)
if command -v vercel &>/dev/null; then
  echo "  [OK] vercel CLI $(vercel --version 2>/dev/null || echo 'present')"
else
  echo "  [WARN] vercel CLI not installed. Deploy can still happen via GitHub integration."
  echo "         Install: npm install -g vercel"
fi

echo ""

# ── Step 2: Install dependencies ────────────────────────────────────────────
echo "━━━ Step 2: Installing npm dependencies ━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$PROJECT_DIR"
npm install --no-audit --no-fund
echo "  [OK] Dependencies installed"
echo ""

# ── Step 3: Build check ────────────────────────────────────────────────────
echo "━━━ Step 3: Build verification ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npm run build 2>&1 | tail -5
echo "  [OK] Build completed successfully"
echo ""

# ── Step 4: Supabase setup ─────────────────────────────────────────────────
echo "━━━ Step 4: Supabase project setup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$SUPABASE_CLI" = true ]; then
  # Link the project if not already linked
  if [ ! -f "$PROJECT_DIR/supabase/config.toml" ]; then
    if [ -n "${SUPABASE_PROJECT_ID:-}" ]; then
      echo "  Linking Supabase project: $SUPABASE_PROJECT_ID"
      supabase link --project-ref "$SUPABASE_PROJECT_ID"
    else
      echo "  [SKIP] SUPABASE_PROJECT_ID not set. Run: supabase link"
    fi
  else
    echo "  [OK] Supabase project already linked"
  fi

  # Apply migrations
  echo "  Applying database migrations..."
  supabase db push --linked
  echo "  [OK] Migrations applied"
else
  echo "  [SKIP] Install supabase CLI and run:"
  echo "    supabase link --project-ref <PROJECT_REF>"
  echo "    supabase db push --linked"
  echo ""
  echo "  Alternatively, apply the SQL directly via Supabase Dashboard:"
  echo "    SQL Editor → New query → Paste supabase/migrations/20260527000000_init.sql → Run"
fi
echo ""

# ── Step 5: Verify migration applied ────────────────────────────────────────
echo "━━━ Step 5: Realtime & Storage verification ━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "  After migration, verify in Supabase Dashboard:"
echo "    - Database → Replication: messages + conversations should be in supabase_realtime"
echo "    - Storage → buckets: 'avatars' bucket should exist"
echo "    - Authentication → Hooks: on_auth_user_created trigger should be active"
echo ""

# ── Step 6: Vercel deployment ──────────────────────────────────────────────
echo "━━━ Step 6: Vercel deployment ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v vercel &>/dev/null; then
  # Check if project is linked
  if [ ! -d "$PROJECT_DIR/.vercel" ]; then
    echo "  Linking Vercel project..."
    vercel link --confirm
  else
    echo "  [OK] Vercel project already linked"
  fi

  # Set environment variables
  echo "  Setting environment variables..."
  for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
    if [ -n "${!key:-}" ]; then
      echo "    Setting $key..."
      vercel env add "$key" production <<< "${!key}" 2>/dev/null || true
    else
      echo "    [SKIP] $key is not set. Set manually: vercel env add $key production"
    fi
  done

  # Deploy
  echo "  Deploying to Vercel..."
  vercel --prod --yes
  echo "  [OK] Deployment complete"
else
  echo "  [SKIP] Deploy via Vercel CLI or push to GitHub:"
  echo "    1. Push to GitHub: git push origin main"
  echo "    2. Import repo at https://vercel.com/import"
  echo "    3. Set environment variables in Vercel Dashboard:"
  echo "       - NEXT_PUBLIC_SUPABASE_URL"
  echo "       - NEXT_PUBLIC_SUPABASE_ANON_KEY"
  echo "       - SUPABASE_SERVICE_ROLE_KEY"
  echo "    4. Deploy"
fi
echo ""

# ── Step 7: Health check guidance ──────────────────────────────────────────
echo "━━━ Step 7: Verify deployment ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Visit your deployed URL and verify:"
echo "    [ ] Register a new user"
echo "    [ ] Login with the new user"
echo "    [ ] Create a conversation"
echo "    [ ] Send a real-time message"
echo "    [ ] View profile page"
echo "    [ ] Upload an avatar"
echo "    [ ] Logout"
echo ""
echo "  Health check endpoints:"
echo "    GET  /              → Landing page (200)"
echo "    GET  /login         → Login page"
echo "    POST /api/auth/me   → Current user info (401 if unauthenticated)"
echo ""

echo "==> Deploy script finished."
