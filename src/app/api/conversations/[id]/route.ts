import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(
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

    // Verify user is a participant (not soft-deleted)
    const { data: participant, error: partError } = await supabase
      .from("conversation_participants")
      .select("user_id")
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

    // ── Cursor-based pagination for messages ──────────────────────
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor"); // ISO timestamp of oldest loaded msg
    const limitParam = searchParams.get("limit");
    const pageLimit = Math.min(Math.max(parseInt(limitParam || "50", 10) || 50, 1), 200);

    // Fetch the conversation
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Fetch participants
    const { data: participants, error: allPartError } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", id)
      .is("deleted_at", null);

    if (allPartError) throw allPartError;

    const userIds = (participants ?? []).map((p) => p.user_id);

    // Fetch user profiles for participants
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, username, display_name, avatar_url")
      .in("user_id", userIds);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p])
    );

    // Fetch messages with cursor-based pagination
    const pageSize = pageLimit + 1; // Fetch 1 extra to detect hasMore
    let msgQuery = supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
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

    // Return messages in chronological order for rendering
    pageMessages.reverse();

    const nextCursor =
      pageMessages.length > 0
        ? pageMessages[0].created_at
        : null;

    // Fetch sender profiles for messages
    const senderIds = [
      ...new Set(
        (messages ?? [])
          .map((m) => m.sender_id)
          .filter((id): id is string => id !== null),
      ),
    ];
    const { data: senderProfiles } = await supabase
      .from("user_profiles")
      .select("user_id, username, avatar_url")
      .in("user_id", senderIds);

    const senderProfileMap = new Map(
      (senderProfiles ?? []).map((p) => [p.user_id, p])
    );

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        isGroup: conversation.is_group,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        lastMessageAt: conversation.last_message_at,
        participants: userIds.map((uid) => {
          const prof = profileMap.get(uid);
          return {
            id: uid,
            username: prof?.username ?? "unknown",
            email: null,
            displayName: prof?.display_name ?? prof?.username ?? "Unknown",
            avatarUrl: prof?.avatar_url ?? null,
          };
        }),
        messages: (pageMessages ?? []).map((m) => {
          const sender = m.sender_id
            ? senderProfileMap.get(m.sender_id) ?? null
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
      },
      pagination: {
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── DELETE /api/conversations/[id] ─────────────────────────────────────────
// Soft-delete a conversation for the current user (set deleted_at on participant)
// The conversation itself stays for other participants.

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

    // Verify user is an active participant
    const { data: participant, error: partError } = await supabase
      .from("conversation_participants")
      .select("id")
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

    // Soft-delete this user's participation
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("conversation_participants")
      .update({ deleted_at: now })
      .eq("id", participant.id);

    if (updateError) throw updateError;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
