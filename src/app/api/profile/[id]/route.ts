import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ── GET /api/profile/[id] ────────────────────────────────────────────────────
// Returns a public profile (minimal fields: username, avatar_url, created_at only).
// Accessible without authentication for avatar rendering and user lookup.

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
      .from("user_profiles")
      .select("username, avatar_url, created_at")
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
        username: profile.username,
        avatarUrl: profile.avatar_url ?? null,
        createdAt: profile.created_at,
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
