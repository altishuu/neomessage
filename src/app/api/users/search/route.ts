import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = request.nextUrl.searchParams.get("q")?.trim();

    if (!q || q.length < 2) {
      return NextResponse.json({ users: [] });
    }

    // Search user_profiles by username or display_name, excluding the current user
    const { data: profiles, error: profError } = await supabase
      .from("user_profiles")
      .select("user_id, username, display_name, avatar_url, created_at")
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
      createdAt: p.created_at,
    }));

    return NextResponse.json({ users });
  } catch (error) {
    console.error("Search users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
