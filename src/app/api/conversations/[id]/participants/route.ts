import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ── POST /api/conversations/[id]/participants ──────────────────────────────
// Add participants to an existing group conversation

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify the current user is an admin or participant of the conversation
    const { data: participant } = await supabase
      .from("conversation_participants")
      .select("id, role")
      .eq("conversation_id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!participant) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    // Verify it's a group conversation
    const { data: conv } = await supabase
      .from("conversations")
      .select("is_group")
      .eq("id", id)
      .single();

    if (!conv?.is_group) {
      return NextResponse.json(
        { error: "Can only add participants to group conversations" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { userIds } = body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: "userIds array is required" },
        { status: 400 }
      );
    }

    // Validate users exist
    const { data: existingProfiles } = await supabase
      .from("user_profiles")
      .select("user_id")
      .in("user_id", userIds);

    const foundIds = new Set(
      (existingProfiles ?? []).map((p) => p.user_id)
    );
    const missing = userIds.filter((uid) => !foundIds.has(uid));

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Users not found: ${missing.join(", ")}`,
        },
        { status: 404 }
      );
    }

    // Check max participants (20)
    const { data: currentParticipants } = await supabase
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", id)
      .is("deleted_at", null);

    const currentCount = currentParticipants?.length ?? 0;
    const maxAllowed = 20;

    if (currentCount + userIds.length > maxAllowed) {
      return NextResponse.json(
        {
          error: `Maximum ${maxAllowed} participants per conversation`,
        },
        { status: 400 }
      );
    }

    const { data: existingParts } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", id)
      .is("deleted_at", null);

    const alreadyIn = new Set(
      (existingParts ?? []).map((p) => p.user_id)
    );
    const newUserIds = userIds.filter((uid) => alreadyIn.has(uid) === false);

    if (newUserIds.length === 0) {
      return NextResponse.json(
        { error: "All users are already participants" },
        { status: 409 }
      );
    }

    // Also revive soft-deleted participants if they're being re-added
    const { data: deletedParts } = await supabase
      .from("conversation_participants")
      .select("id, user_id")
      .eq("conversation_id", id)
      .neq("deleted_at", null);

    const deletedMap = new Map<string, string>(
      (deletedParts ?? []).map((p: { user_id: string; id: string }) => [p.user_id, p.id])
    );

    const toRevive: string[] = [];
    const toInsert: { conversation_id: string; user_id: string }[] = [];

    for (const uid of newUserIds) {
      const deletedId = deletedMap.get(uid);
      if (deletedId) {
        toRevive.push(deletedId);
      } else {
        toInsert.push({
          conversation_id: id,
          user_id: uid,
        });
      }
    }

    // Revive soft-deleted participants (set deleted_at = null)
    if (toRevive.length > 0) {
      const { error: reviveError } = await supabase
        .from("conversation_participants")
        .update({ deleted_at: null, joined_at: new Date().toISOString() })
        .in("id", toRevive);

      if (reviveError) throw reviveError;
    }

    // Insert new participants
    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("conversation_participants")
        .insert(toInsert);

      if (insertError) throw insertError;
    }

    // Fetch profiles of newly added users for response
    const { data: newProfiles } = await supabase
      .from("user_profiles")
      .select("user_id, username, display_name, avatar_url")
      .in("user_id", newUserIds);

    return NextResponse.json({
      participants: (newProfiles ?? []).map((p) => ({
        id: p.user_id,
        username: p.username,
        displayName: p.display_name,
        avatarUrl: p.avatar_url,
      })),
    });
  } catch (error) {
    console.error("Add participants error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── DELETE /api/conversations/[id]/participants ────────────────────────────
// Remove a participant (leave conversation or kick from group)

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Parse optional userId from body — default to current user (leave self)
    let targetUserId: string;
    try {
      const body = await request.json();
      targetUserId = body.userId ?? user.id;
    } catch {
      targetUserId = user.id;
    }

    // If removing another user, verify requester is still a participant
    if (targetUserId !== user.id) {
      const { data: requester } = await supabase
        .from("conversation_participants")
        .select("id")
        .eq("conversation_id", id)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!requester) {
        return NextResponse.json(
          { error: "You are not a participant of this conversation" },
          { status: 403 }
        );
      }
    }

    // Soft-delete the participant (set deleted_at)
    const { data: participant } = await supabase
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", id)
      .eq("user_id", targetUserId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!participant) {
      return NextResponse.json(
        { error: "Participant not found" },
        { status: 404 }
      );
    }

    const { error: updateError } = await supabase
      .from("conversation_participants")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", participant.id);

    if (updateError) throw updateError;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Remove participant error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
