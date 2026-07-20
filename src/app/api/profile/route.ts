import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROFILE_SELECT =
  "user_id, username, display_name, avatar_url, avatar_updated_at, created_at";

function mapProfile(p: {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_updated_at: string | null;
  created_at: string;
}) {
  return {
    id: p.user_id,
    username: p.username,
    displayName: p.display_name ?? p.username,
    avatarUrl: p.avatar_url ?? null,
    avatarUpdatedAt: p.avatar_updated_at ?? null,
    createdAt: p.created_at,
  };
}

function mapProfileWithEmail(
  p: {
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    avatar_updated_at: string | null;
    created_at: string;
  },
  email: string,
) {
  return {
    id: p.user_id,
    email,
    username: p.username,
    displayName: p.display_name ?? p.username,
    avatarUrl: p.avatar_url ?? null,
    avatarUpdatedAt: p.avatar_updated_at ?? null,
    createdAt: p.created_at,
  };
}

// ── GET /api/profile ─────────────────────────────────────────────────────────
// Returns the authenticated user's full profile including email.

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

    // Fetch profile from user_profiles
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select(PROFILE_SELECT)
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Profile fetch error:", profileError);
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json({
      user: mapProfileWithEmail(profile, user.email ?? ""),
    });
  } catch (error) {
    console.error("GET /api/profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── PATCH /api/profile ───────────────────────────────────────────────────────
// Updates display_name and/or avatar_url for the current user.

export async function PATCH(request: NextRequest) {
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
    const { displayName, avatarUrl } = body;

    // At least one field must be provided
    if (displayName === undefined && avatarUrl === undefined) {
      return NextResponse.json(
        {
          error:
            "At least one field to update is required: displayName, avatarUrl",
        },
        { status: 400 },
      );
    }

    // Build update payload (use snake_case for DB columns)
    const updateData: TablesUpdate<"user_profiles"> = {};

    if (displayName !== undefined) {
      if (typeof displayName !== "string") {
        return NextResponse.json(
          { error: "displayName must be a string" },
          { status: 400 },
        );
      }
      const trimmed = displayName.trim();
      if (trimmed.length === 0) {
        return NextResponse.json(
          { error: "displayName cannot be empty" },
          { status: 400 },
        );
      }
      if (trimmed.length > 50) {
        return NextResponse.json(
          { error: "displayName must be 50 characters or less" },
          { status: 400 },
        );
      }
      updateData.display_name = trimmed;
    }

    if (avatarUrl !== undefined) {
      if (typeof avatarUrl !== "string") {
        return NextResponse.json(
          { error: "avatarUrl must be a string" },
          { status: 400 },
        );
      }
      updateData.avatar_url = avatarUrl;
      updateData.avatar_updated_at = new Date().toISOString();
    }

    const { data: profile, error: updateError } = await supabase
      .from("user_profiles")
      .update(updateData)
      .eq("user_id", user.id)
      .select(PROFILE_SELECT)
      .single();

    if (updateError) {
      console.error("Profile update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update profile" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      user: mapProfileWithEmail(profile!, user.email ?? ""),
    });
  } catch (error) {
    console.error("PATCH /api/profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
