import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitHeaders,
} from "@/lib/rate-limiter";

export async function GET(request: NextRequest) {
  try {
    // ── Rate limiting ──────────────────────────────────────────────────────
    const ip = getClientIp(request);
    const rl = checkRateLimit(`search:${ip}`, 30, 60_000);

    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: rateLimitHeaders(rl, 30),
        },
      );
    }

    // ── Authentication ─────────────────────────────────────────────────────
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Search ─────────────────────────────────────────────────────────────
    const q = request.nextUrl.searchParams.get("q")?.trim();

    if (!q || q.length < 2) {
      return NextResponse.json({ users: [] });
    }

    // Use the public_user_profiles view (exposes only public columns by design)
    const { data: profiles, error: profError } = await supabase
      .from("public_user_profiles")
      .select("user_id, username, display_name, avatar_url")
      .neq("user_id", user.id)
      .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
      .limit(20);

    if (profError) throw profError;

    const users = (profiles ?? []).map((p) => ({
      id: p.user_id,
      email: null, // Not exposed — use profile info for privacy
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
    }));

    const response = NextResponse.json({ users }, { status: 200 });
    for (const [key, value] of Object.entries(rateLimitHeaders(rl, 30))) {
      response.headers.set(key, value);
    }
    return response;
  } catch (error) {
    console.error("Search users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
