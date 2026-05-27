import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uploadAvatar } from "@/lib/supabase/storage";

// ── POST /api/profile/avatar ─────────────────────────────────────────────────
// Uploads a new avatar image to Supabase Storage (avatars bucket).
// Accepts multipart/form-data with a single "avatar" file field.

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

    // Verify profile exists
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Parse the multipart form data
    const formData = await request.formData();
    const file = formData.get("avatar");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Avatar file is required (field: 'avatar')" },
        { status: 400 },
      );
    }

    // Validate file type
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error: `Invalid file type. Allowed: ${allowedTypes.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Validate file size (max 5 MB)
    const maxSize = 5 * 1024 * 1024; // 5 MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5 MB" },
        { status: 400 },
      );
    }

    // Read the file into a Buffer for upload
    const arrayBuffer = await file.arrayBuffer();

    // Upload to Supabase Storage
    let avatarUrl: string;
    try {
      avatarUrl = await uploadAvatar(
        user.id,
        file.name,
        Buffer.from(arrayBuffer),
        file.type,
      );
    } catch (uploadError) {
      console.error("Avatar upload failed:", uploadError);
      return NextResponse.json(
        {
          error:
            uploadError instanceof Error
              ? uploadError.message
              : "Avatar upload failed",
        },
        { status: 500 },
      );
    }

    // Update user_profiles with new avatar_url
    const { data: updatedProfile, error: updateError } = await supabase
      .from("user_profiles")
      .update({ avatar_url: avatarUrl })
      .eq("user_id", user.id)
      .select("user_id, username, display_name, avatar_url, created_at")
      .single();

    if (updateError) {
      console.error("Profile avatar update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update profile avatar" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      user: {
        id: updatedProfile.user_id,
        username: updatedProfile.username,
        displayName: updatedProfile.display_name ?? updatedProfile.username,
        avatarUrl: updatedProfile.avatar_url ?? null,
        createdAt: updatedProfile.created_at,
      },
      avatarUrl,
    });
  } catch (error) {
    console.error("POST /api/profile/avatar error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
