import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PATCH(
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

    // Verify user is an active participant (not soft-deleted)
    const { data: participant, error: partError } = await supabase
      .from("conversation_participants")
      .select("id, is_pinned")
      .eq("conversation_id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (partError) throw partError;

    if (!participant) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 }
      );
    }

    // Parse optional body; default to toggle if omitted
    let newPinned: boolean;
    try {
      const body = await request.json();
      if (typeof body.isPinned === "boolean") {
        newPinned = body.isPinned;
      } else {
        // Toggle current value
        newPinned = !participant.is_pinned;
      }
    } catch {
      // No body or invalid JSON — toggle
      newPinned = !participant.is_pinned;
    }

    // Update the is_pinned flag for this user's participation
    const { error: updateError } = await supabase
      .from("conversation_participants")
      .update({ is_pinned: newPinned })
      .eq("id", participant.id);

    if (updateError) throw updateError;

    return NextResponse.json({ isPinned: newPinned });
  } catch (error) {
    console.error("Pin conversation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
