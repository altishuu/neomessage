import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";


// ── Supported emoji reactions ──────────────────────────────────────────────
const SUPPORTED_REACTIONS = new Set([
  "👍", // like / thumbs up
  "❤️", // heart
  "😂", // joy / laugh
  "😮", // surprise
  "😢", // sad / cry
  "🙏", // pray / thanks
  "🎉", // party / celebrate
  "🔥", // fire
  "💯", // 100 / top
  "👎", // dislike
]);

function isValidReaction(reaction: unknown): reaction is string {
  return typeof reaction === "string" && SUPPORTED_REACTIONS.has(reaction);
}

// ── Helper: validate reaction body ─────────────────────────────────────────
function parseReactionBody(body: unknown): { reaction: string } | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const { reaction } = obj;
  if (!isValidReaction(reaction)) return null;
  return { reaction };
}

// ── Shared participant check ───────────────────────────────────────────────
/**
 * Verify the message exists (not soft-deleted) and the authenticated user
 * is an active participant in its conversation.
 * Returns the conversation_id on success, or a NextResponse on failure.
 */
async function verifyAccess(
  supabase: ReturnType<typeof createSupabaseServerClient> extends Promise<infer T>
    ? T
    : never,
  messageId: string,
  userId: string,
): Promise<
  | { ok: true; conversationId: string }
  | { ok: false; response: NextResponse }
> {
  const { data: message, error: msgError } = await supabase
    .from("messages")
    .select("id, conversation_id")
    .eq("id", messageId)
    .is("deleted_at", null)
    .single();

  if (msgError || !message) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Message not found" },
        { status: 404 },
      ),
    };
  }

  const { data: participant, error: partError } = await supabase
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", message.conversation_id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (partError) throw partError;

  if (!participant) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, conversationId: message.conversation_id };
}

// ── GET /api/messages/[id]/reactions ───────────────────────────────────────
/**
 * Fetch all reactions for a message, with user profile info.
 *
 * Response:
 * ```json
 * {
 *   "reactions": [
 *     {
 *       "id": "uuid",
 *       "messageId": "uuid",
 *       "userId": "uuid",
 *       "reaction": "👍",
 *       "createdAt": "2026-05-28T...",
 *       "user": { "id": "uuid", "username": "...", "avatarUrl": "..." }
 *     }
 *   ]
 * }
 * ```
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    const { id: messageId } = await params;

    const access = await verifyAccess(supabase, messageId, user.id);
    if (!access.ok) return access.response;

    // Fetch all reactions for this message
    const { data: reactions, error: reactError } = await supabase
      .from("message_reactions")
      .select("id, message_id, user_id, reaction, created_at")
      .eq("message_id", messageId)
      .order("created_at", { ascending: true });

    if (reactError) throw reactError;

    const reactionRows = reactions ?? [];

    // Fetch user profiles for the reactors
    const userIds = [...new Set(reactionRows.map((r) => r.user_id))];

    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, username, avatar_url, avatar_updated_at")
      .in("user_id", userIds);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p]),
    );

    return NextResponse.json({
      reactions: reactionRows.map((r) => {
        const profile = profileMap.get(r.user_id);
        return {
          id: r.id,
          messageId: r.message_id,
          userId: r.user_id,
          reaction: r.reaction,
          createdAt: r.created_at,
          user: profile
            ? {
                id: profile.user_id,
                username: profile.username,
                avatarUrl: profile.avatar_url,
                avatarUpdatedAt: profile.avatar_updated_at ?? null,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    console.error("Get reactions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST /api/messages/[id]/reactions ──────────────────────────────────────
/**
 * Add a reaction to a message. Idempotent — if the same user already reacted
 * with the same emoji, the row is preserved (ON CONFLICT DO NOTHING).
 *
 * Request body: `{ "reaction": "👍" }`
 * Response (201): the new (or existing) reaction object.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    const { id: messageId } = await params;

    // Parse and validate body
    const body = parseReactionBody(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json(
        { error: "Invalid reaction. Supported emojis: 👍❤️😂😮😢🙏🎉🔥💯👎" },
        { status: 400 },
      );
    }

    const access = await verifyAccess(supabase, messageId, user.id);
    if (!access.ok) return access.response;

    // Upsert — ON CONFLICT DO NOTHING makes this idempotent
    const { data: inserted, error: insertError } = await supabase
      .from("message_reactions")
      .upsert(
        {
          message_id: messageId,
          user_id: user.id,
          reaction: body.reaction,
        },
        {
          onConflict: "message_id, user_id, reaction",
          ignoreDuplicates: true,
        },
      )
      .select("id, message_id, user_id, reaction, created_at")
      .maybeSingle();

    if (insertError) throw insertError;

    // If upsert found an existing row instead of inserting, fetch it
    let reaction = inserted;
    if (!reaction) {
      const { data: existing } = await supabase
        .from("message_reactions")
        .select("id, message_id, user_id, reaction, created_at")
        .eq("message_id", messageId)
        .eq("user_id", user.id)
        .eq("reaction", body.reaction)
        .single();

      reaction = existing;
    }

    if (!reaction) {
      throw new Error("Failed to retrieve reaction after upsert");
    }

    // Fetch user profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("user_id, username, avatar_url, avatar_updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json(
      {
        reaction: {
          id: reaction.id,
          messageId: reaction.message_id,
          userId: reaction.user_id,
          reaction: reaction.reaction,
          createdAt: reaction.created_at,
          user: profile
            ? {
                id: profile.user_id,
                username: profile.username,
                avatarUrl: profile.avatar_url,
                avatarUpdatedAt: profile.avatar_updated_at ?? null,
              }
            : null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Add reaction error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── DELETE /api/messages/[id]/reactions ────────────────────────────────────
/**
 * Remove a reaction from a message. Only the reaction owner can delete
 * their own reaction.
 *
 * Request body: `{ "reaction": "👍" }`
 * Response: 204 No Content
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    const { id: messageId } = await params;

    // Parse and validate body
    const body = parseReactionBody(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json(
        { error: "Invalid reaction. Supported emojis: 👍❤️😂😮😢🙏🎉🔥💯👎" },
        { status: 400 },
      );
    }

    // Fetch the reaction row to verify ownership before deleting
    const { data: existing, error: fetchError } = await supabase
      .from("message_reactions")
      .select("id")
      .eq("message_id", messageId)
      .eq("user_id", user.id)
      .eq("reaction", body.reaction)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!existing) {
      return NextResponse.json(
        { error: "Reaction not found" },
        { status: 404 },
      );
    }

    // Delete the reaction (RLS enforces owner-only delete, but we already verified)
    const { error: deleteError } = await supabase
      .from("message_reactions")
      .delete()
      .eq("id", existing.id);

    if (deleteError) throw deleteError;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Delete reaction error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
