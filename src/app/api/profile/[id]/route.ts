import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ── GET /api/profile/[id] ────────────────────────────────────────────────────
// Returns a public profile (minimal fields: username, display_name, avatar_url).
// Accessible without authentication — queries the public_user_profiles view which
// is RLS-gated at the view level and exposes only public columns by design.
// See: supabase/migrations/20260527000001_restrict_user_profiles_rls.sql

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const { id } = await params;

    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 },
      );
    }

    const { data: profile, error } = await supabase
      .from("public_user_profiles")
      .select("user_id, username, display_name, avatar_url")
      .eq("user_id", id)
      .maybeSingle();

    if (error) {
      console.error("Public profile fetch error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: profile.user_id,
        username: profile.username,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url ?? null,
      },
    });
  } catch (error) {
    console.error("GET /api/profile/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
