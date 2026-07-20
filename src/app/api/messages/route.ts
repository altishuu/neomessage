import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_CONTENT_LENGTH = 4000;

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
    const { conversationId, content } = body;

    if (!conversationId || !content) {
      return NextResponse.json(
        { error: "conversationId and content are required" },
        { status: 400 }
      );
    }

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "Content must be a string" },
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

    // Verify sender is a participant (not soft-deleted)
    const { data: participant, error: partError } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (partError) throw partError;

    if (!participant) {
      return NextResponse.json(
        { error: "You are not a participant of this conversation" },
        { status: 403 }
      );
    }

    // Insert the message
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .insert({
        content: trimmedContent,
        conversation_id: conversationId,
        sender_id: user.id,
        type: "text",
      })
      .select("*")
      .single();

    if (msgError) throw msgError;

    // The DB trigger bump_conversation_timestamp() handles updating
    // updated_at and last_message_at on the conversations table.

    // Fetch the sender profile
    const { data: senderProfile } = await supabase
      .from("user_profiles")
      .select("user_id, username, avatar_url, avatar_updated_at")
      .eq("user_id", user.id)
      .single();

    return NextResponse.json(
      {
        message: {
          id: message.id,
          content: message.content,
          senderId: message.sender_id,
          sender: senderProfile
            ? {
                id: senderProfile.user_id,
                username: senderProfile.username,
                avatarUrl: senderProfile.avatar_url,
                avatarUpdatedAt: senderProfile.avatar_updated_at ?? null,
              }
            : null,
          type: message.type,
          conversationId: message.conversation_id,
          createdAt: message.created_at,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Send message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
