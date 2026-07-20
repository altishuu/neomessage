import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    const q = searchParams.get("q");
    const conversationId = searchParams.get("conversationId");

    if (!q || q.trim().length < 2) {
      return NextResponse.json(
        { error: "Query parameter 'q' must be at least 2 characters" },
        { status: 400 }
      );
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId parameter is required" },
        { status: 400 }
      );
    }

    // Verify the user is a participant of this conversation
    const { data: participant, error: partError } = await supabase
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", conversationId)
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

    // Search messages using the database function
    const { data: messages, error: searchError } = await supabase.rpc(
      "search_messages",
      {
        conv_id: conversationId,
        search_query: q.trim(),
        max_results: 50,
      }
    );

    if (searchError) throw searchError;

    return NextResponse.json({
      messages: (messages ?? []).map((msg: Record<string, unknown>) => ({
        id: msg.id,
        conversationId: msg.conversation_id,
        senderId: msg.sender_id,
        content: msg.content,
        createdAt: msg.created_at,
        rank: msg.rank,
        sender: msg.sender_id
          ? {
              id: msg.sender_id,
              username: msg.sender_username,
              avatarUrl: msg.sender_avatar_url,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error("Message search error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
