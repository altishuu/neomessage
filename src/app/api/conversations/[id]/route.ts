import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(
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

    // Fetch recent messages (last 50)
    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(50);

    if (msgError) throw msgError;

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
        messages: (messages ?? []).map((m) => {
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
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
