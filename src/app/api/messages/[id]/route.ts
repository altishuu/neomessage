import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_CONTENT_LENGTH = 4000;

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

    // Fetch the message
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .select("*")
      .eq("id", id)
      .single();

    if (msgError || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    // Check if the message is soft-deleted
    if (message.deleted_at) {
      return NextResponse.json(
        { error: "Cannot edit a deleted message" },
        { status: 409 }
      );
    }

    // Only the sender can edit
    if (message.sender_id !== user.id) {
      return NextResponse.json(
        { error: "You can only edit your own messages" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Content must be a non-empty string" },
        { status: 400 }
      );
    }

    const trimmedContent = content.trim();

    if (trimmedContent.length === 0) {
      return NextResponse.json(
        { error: "Content must be a non-empty string" },
        { status: 400 }
      );
    }

    if (trimmedContent.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `Content must be at most ${MAX_CONTENT_LENGTH} characters` },
        { status: 400 }
      );
    }

    // Update the message content and timestamp
    const { data: updatedMessage, error: updateError } = await supabase
      .from("messages")
      .update({
        content: trimmedContent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    // Fetch the sender profile
    const { data: senderProfile } = await supabase
      .from("user_profiles")
      .select("user_id, username, avatar_url, avatar_updated_at")
      .eq("user_id", updatedMessage.sender_id ?? "")
      .maybeSingle();

    return NextResponse.json({
      message: {
        id: updatedMessage.id,
        content: updatedMessage.content,
        senderId: updatedMessage.sender_id,
        sender: senderProfile
          ? {
              id: senderProfile.user_id,
              username: senderProfile.username,
              avatarUrl: senderProfile.avatar_url,
              avatarUpdatedAt: senderProfile.avatar_updated_at ?? null,
            }
          : null,
        type: updatedMessage.type,
        conversationId: updatedMessage.conversation_id,
        createdAt: updatedMessage.created_at,
        updatedAt: updatedMessage.updated_at,
      },
    });
  } catch (error) {
    console.error("Edit message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
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

    // Fetch the message
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .select("*")
      .eq("id", id)
      .single();

    if (msgError || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    // Check if the message is already soft-deleted
    if (message.deleted_at) {
      return NextResponse.json(
        { error: "Message is already deleted" },
        { status: 409 }
      );
    }

    // Only the sender can delete
    if (message.sender_id !== user.id) {
      return NextResponse.json(
        { error: "You can only delete your own messages" },
        { status: 403 }
      );
    }

    // Soft-delete: set deleted_at timestamp
    const { error: deleteError } = await supabase
      .from("messages")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
