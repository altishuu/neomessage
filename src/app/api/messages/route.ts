import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_CONTENT_LENGTH = 4000;

// ── GET /api/messages?conversationId=&cursor=&limit= ───────────────────────
// Cursor-based pagination for older messages. Returns messages in
// chronological order (oldest first) with hasMore/nextCursor.
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

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId");
    const cursor = searchParams.get("cursor"); // ISO timestamp of oldest loaded msg
    const limitParam = searchParams.get("limit");
    const pageLimit = Math.min(
      Math.max(parseInt(limitParam || "50", 10) || 50, 1),
      200,
    );

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }

    // Verify user is a participant
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
        { error: "Conversation not found or access denied" },
        { status: 404 },
      );
    }

    // Fetch messages with cursor-based pagination
    const pageSize = pageLimit + 1; // Fetch 1 extra to detect hasMore
    let msgQuery = supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(pageSize);

    if (cursor) {
      msgQuery = msgQuery.lt("created_at", cursor);
    }

    const { data: messages, error: msgError } = await msgQuery;

    if (msgError) throw msgError;

    const hasMore = (messages?.length ?? 0) > pageLimit;
    const pageMessages = hasMore
      ? (messages ?? []).slice(0, pageLimit)
      : (messages ?? []);

    // Return messages in chronological order
    pageMessages.reverse();

    const nextCursor =
      pageMessages.length > 0
        ? pageMessages[0].created_at
        : null;

    // Fetch sender profiles
    const senderIds = [
      ...new Set(
        (pageMessages ?? [])
          .map((m) => m.sender_id)
          .filter((id): id is string => id !== null),
      ),
    ];
    const { data: senderProfiles } = await supabase
      .from("user_profiles")
      .select("user_id, username, avatar_url, avatar_updated_at")
      .in("user_id", senderIds);

    const senderProfileMap = new Map(
      (senderProfiles ?? []).map((p) => [p.user_id, p]),
    );

    return NextResponse.json({
      messages: (pageMessages ?? []).map((m) => {
        const sender = m.sender_id
          ? (senderProfileMap.get(m.sender_id) ?? null)
          : null;
        return {
          id: m.id,
          content: m.content,
          senderId: m.sender_id,
          sender: sender
            ? {
                id: sender.user_id,
                username: sender.username,
                avatarUrl: sender.avatar_url,
                avatarUpdatedAt: sender.avatar_updated_at ?? null,
              }
            : null,
          type: m.type,
          conversationId: m.conversation_id,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
          deletedAt: m.deleted_at,
          metadata: m.metadata,
        };
      }),
      pagination: {
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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
