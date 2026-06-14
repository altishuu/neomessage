import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ────────────────────────────────────────────────────────────────────────────
// GET /api/users/block — list blocked users
// ────────────────────────────────────────────────────────────────────────────
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch blocked user IDs
    const { data: blocks, error: blockError } = await supabase
      .from("blocked_users")
      .select("blocked_id, created_at")
      .eq("blocker_id", user.id)
      .order("created_at", { ascending: false });

    if (blockError) throw blockError;

    if (!blocks || blocks.length === 0) {
      return NextResponse.json({ blockedUsers: [] });
    }

    // Fetch profiles for blocked users
    const blockedIds = blocks.map((b: { blocked_id: string }) => b.blocked_id);
    const { data: profiles, error: profError } = await supabase
      .from("user_profiles")
      .select("user_id, username, display_name, avatar_url")
      .in("user_id", blockedIds);

    if (profError) throw profError;

    const profileMap = new Map(
      (profiles ?? []).map((p: { user_id: string; username: string; display_name: string; avatar_url: string | null }) => [p.user_id, p])
    );

    const blockedUsers = blocks.map((b: { blocked_id: string; created_at: string }) => {
      const prof = profileMap.get(b.blocked_id);
      return {
        id: b.blocked_id,
        username: prof?.username ?? "unknown",
        displayName: prof?.display_name ?? prof?.username ?? "Unknown",
        avatarUrl: prof?.avatar_url ?? null,
        blockedAt: b.created_at,
      };
    });

    return NextResponse.json({ blockedUsers });
  } catch (error) {
    console.error("List blocked users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/users/block — block a user
// Body: { userId: string }
// ────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId }: { userId: string } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Cannot block yourself
    if (userId === user.id) {
      return NextResponse.json(
        { error: "Cannot block yourself" },
        { status: 400 }
      );
    }

    // Verify the target user exists
    const { data: targetProfile, error: targetError } = await supabase
      .from("user_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (targetError) throw targetError;

    if (!targetProfile) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Insert the block (RLS policy ensures blocker_id = auth.uid())
    const { error: insertError } = await supabase
      .from("blocked_users")
      .insert({
        blocker_id: user.id,
        blocked_id: userId,
      });

    if (insertError) {
      // Unique constraint violation means already blocked
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "User is already blocked" },
          { status: 409 }
        );
      }
      throw insertError;
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Block user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/users/block — unblock a user
// Body: { userId: string }
// ────────────────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId }: { userId: string } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Delete the block (RLS ensures only blocker can delete their own blocks)
    const { error: deleteError } = await supabase
      .from("blocked_users")
      .delete()
      .eq("blocker_id", user.id)
      .eq("blocked_id", userId);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unblock user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
