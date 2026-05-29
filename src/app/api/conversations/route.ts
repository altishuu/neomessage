import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

    // Fetch conversations where the user is a participant (not soft-deleted)
    const { data: participations, error: partError } = await supabase
      .from("conversation_participants")
      .select("conversation_id, last_read_at, is_pinned")
      .eq("user_id", user.id)
      .is("deleted_at", null);

    if (partError) throw partError;

    if (!participations || participations.length === 0) {
      return NextResponse.json({ conversations: [] });
    }

    const conversationIds = participations.map((p) => p.conversation_id);

    // Fetch the conversations
    const { data: conversations, error: convError } = await supabase
      .from("conversations")
      .select("*")
      .in("id", conversationIds)
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false });

    if (convError) throw convError;

    if (!conversations || conversations.length === 0) {
      return NextResponse.json({ conversations: [] });
    }

    // Fetch all participants for these conversations
    const { data: allParticipants, error: allPartError } = await supabase
      .from("conversation_participants")
      .select("id, conversation_id, user_id, joined_at")
      .in("conversation_id", conversationIds)
      .is("deleted_at", null);

    if (allPartError) throw allPartError;

    // Fetch user profiles for all participant user_ids
    const userIds = [...new Set((allParticipants ?? []).map((p) => p.user_id))];

    const { data: profiles, error: profError } = await supabase
      .from("user_profiles")
      .select("user_id, username, display_name, avatar_url")
      .in("user_id", userIds);

    if (profError) throw profError;

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p])
    );

    // Fetch the latest message per conversation using an optimized DB function
    // (DISTINCT ON + single scan instead of fetching all messages and filtering in JS)
    const { data: lastMessages, error: msgError } = await supabase
      .rpc("get_latest_messages", { conv_ids: conversationIds });

    if (msgError) throw msgError;

    // Build a map of conversation_id → last message
    const lastMessageMap = new Map<string, typeof lastMessages[0]>();
    for (const msg of lastMessages ?? []) {
      lastMessageMap.set(msg.conversation_id, msg);
    }

    // Fetch sender profiles for last messages
    const senderIds = [
      ...new Set(
        (lastMessages ?? [])
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

    // Group participants by conversation
    const participantsByConv = new Map<string, typeof allParticipants>();
    for (const p of allParticipants ?? []) {
      const list = participantsByConv.get(p.conversation_id) ?? [];
      list.push(p);
      participantsByConv.set(p.conversation_id, list);
    }

    // Build a map of conversation_id → isPinned for the current user
    const pinMap = new Map<string, boolean>(
      (participations ?? []).map((p) => [p.conversation_id, p.is_pinned])
    );

    const result = (conversations ?? [])
      .map((conv) => {
        const convParticipants = participantsByConv.get(conv.id) ?? [];
        const lastMsg = lastMessageMap.get(conv.id) ?? null;
        const lastSender = lastMsg?.sender_id
          ? senderProfileMap.get(lastMsg.sender_id) ?? null
          : null;

        return {
          id: conv.id,
          title: conv.title,
          isGroup: conv.is_group,
          isPinned: pinMap.get(conv.id) ?? false,
          createdAt: conv.created_at,
          updatedAt: conv.updated_at,
          lastMessageAt: conv.last_message_at,
          participants: convParticipants.map((p) => {
            const prof = profileMap.get(p.user_id);
            return {
              id: p.user_id,
              username: prof?.username ?? "unknown",
              email: null, // Not exposed to protect privacy — use profile info
              displayName: prof?.display_name ?? prof?.username ?? "Unknown",
              avatarUrl: prof?.avatar_url ?? null,
            };
          }),
          lastMessage: lastMsg
            ? {
                id: lastMsg.id,
                content: lastMsg.content,
                senderId: lastMsg.sender_id,
                sender: lastSender
                  ? {
                      id: lastSender.user_id,
                      username: lastSender.username,
                      avatarUrl: lastSender.avatar_url,
                    }
                  : null,
                conversationId: lastMsg.conversation_id,
                createdAt: lastMsg.created_at,
              }
            : null,
        };
      })
      .sort((a, b) => {
        // Pinned first, then by lastMessageAt descending
        if (a.isPinned !== b.isPinned) {
          return a.isPinned ? -1 : 1;
        }
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      });

    return NextResponse.json({ conversations: result });
  } catch (error) {
    console.error("Get conversations error:", error);
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
    const { participantId, participantIds } = body;

    let allParticipantIds: string[];

    if (participantIds && Array.isArray(participantIds)) {
      allParticipantIds = Array.from(new Set([user.id, ...participantIds]));
    } else if (participantId) {
      allParticipantIds = [user.id, participantId];
    } else {
      return NextResponse.json(
        { error: "participantId or participantIds is required" },
        { status: 400 }
      );
    }

    // Validate all participants exist (have user_profiles — they're auth users)
    const { data: existingProfiles, error: profError } = await supabase
      .from("user_profiles")
      .select("user_id")
      .in("user_id", allParticipantIds);

    if (profError) throw profError;

    if (
      !existingProfiles ||
      existingProfiles.length !== allParticipantIds.length
    ) {
      return NextResponse.json(
        { error: "One or more participants not found" },
        { status: 404 }
      );
    }

    // For 2-person chats, check if a conversation already exists
    if (allParticipantIds.length === 2) {
      const { data: existingP1 } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", allParticipantIds[0])
        .is("deleted_at", null);

      const { data: existingP2 } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", allParticipantIds[1])
        .is("deleted_at", null);

      const p1Ids = new Set(
        (existingP1 ?? []).map((p) => p.conversation_id)
      );
      const p2Ids = new Set(
        (existingP2 ?? []).map((p) => p.conversation_id)
      );

      // Find intersection of conversations (both are participants)
      const sharedIds = [...p1Ids].filter((id) => p2Ids.has(id));

      if (sharedIds.length > 0) {
        // Check which shared conversations have exactly 2 participants
        for (const convId of sharedIds) {
          const { data: participants } = await supabase
            .from("conversation_participants")
            .select("user_id")
            .eq("conversation_id", convId)
            .is("deleted_at", null);

          const pUserIds = (participants ?? []).map((p) => p.user_id);
          const is1on1 =
            pUserIds.length === 2 &&
            pUserIds.includes(allParticipantIds[0]) &&
            pUserIds.includes(allParticipantIds[1]);

          if (is1on1) {
            // Return the existing conversation
            const { data: conv } = await supabase
              .from("conversations")
              .select("*")
              .eq("id", convId)
              .single();

            if (!conv) continue;

            const { data: convParticipants } = await supabase
              .from("conversation_participants")
              .select("user_id")
              .eq("conversation_id", convId)
              .is("deleted_at", null);

            const { data: convProfiles } = await supabase
              .from("user_profiles")
              .select("user_id, username, display_name, avatar_url")
              .in(
                "user_id",
                (convParticipants ?? []).map((p) => p.user_id),
              );

            return NextResponse.json({
              conversation: {
                id: conv.id,
                title: conv.title,
                isGroup: conv.is_group,
                createdAt: conv.created_at,
                updatedAt: conv.updated_at,
                participants: (convProfiles ?? []).map((p) => ({
                  id: p.user_id,
                  username: p.username,
                  email: null,
                  displayName: p.display_name,
                  avatarUrl: p.avatar_url,
                })),
                lastMessage: null,
              },
            });
          }
        }
      }
    }

    // Create the conversation
    const { data: conversation, error: createError } = await supabase
      .from("conversations")
      .insert({
        created_by: user.id,
        is_group: allParticipantIds.length > 2,
      })
      .select("*")
      .single();

    if (createError) throw createError;

    // Add participants
    const participantRows = allParticipantIds.map((uid) => ({
      conversation_id: conversation.id,
      user_id: uid,
    }));

    const { error: partInsertError } = await supabase
      .from("conversation_participants")
      .insert(participantRows);

    if (partInsertError) throw partInsertError;

    // Fetch profiles for the response
    const { data: newProfiles } = await supabase
      .from("user_profiles")
      .select("user_id, username, display_name, avatar_url")
      .in("user_id", allParticipantIds);

    return NextResponse.json(
      {
        conversation: {
          id: conversation.id,
          title: conversation.title,
          isGroup: conversation.is_group,
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
          participants: (newProfiles ?? []).map((p) => ({
            id: p.user_id,
            username: p.username,
            email: null,
            displayName: p.display_name,
            avatarUrl: p.avatar_url,
          })),
          lastMessage: null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create conversation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
