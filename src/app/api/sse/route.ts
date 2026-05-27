import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import * as jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Extract token from cookie or query param
  const token = request.cookies.get("token")?.value;

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let userId: string;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = decoded.userId;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get user's conversation IDs
  const participants = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { conversationId: true },
  });

  const conversationIds = new Set(participants.map((p) => p.conversationId));

  // Track the latest message timestamp we've seen
  let lastPollAt = new Date();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode("event: connected\n"));
      controller.enqueue(encoder.encode("data: {}\n\n"));

      const pollInterval = setInterval(async () => {
        try {
          if (conversationIds.size === 0) {
            // No conversations yet - just update poll time
            lastPollAt = new Date();
            return;
          }

          const messages = await prisma.message.findMany({
            where: {
              conversationId: { in: Array.from(conversationIds) },
              createdAt: { gt: lastPollAt },
            },
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  avatarUrl: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          });

          if (messages.length > 0) {
            for (const message of messages) {
              const data = JSON.stringify({
                type: "new_message",
                data: {
                  id: message.id,
                  content: message.content,
                  senderId: message.senderId,
                  sender: message.sender,
                  conversationId: message.conversationId,
                  readAt: message.readAt,
                  createdAt: message.createdAt,
                },
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          lastPollAt = new Date();
        } catch (err) {
          console.error("SSE poll error:", err);
        }
      }, 2000);

      // Clean up on connection close
      request.signal.addEventListener("abort", () => {
        clearInterval(pollInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
