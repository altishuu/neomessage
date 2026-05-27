import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromToken } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getUserIdFromToken(token);
  if (!userId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { id } = await params;

  // Verify user is a participant
  const participant = await prisma.conversationParticipant.findUnique({
    where: {
      userId_conversationId: {
        userId,
        conversationId: id,
      },
    },
  });

  if (!participant) {
    return NextResponse.json(
      { error: "Conversation not found or access denied" },
      { status: 404 }
    );
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      participants: conversation.participants.map((p) => ({
        id: p.user.id,
        username: p.user.username,
        email: p.user.email,
        avatarUrl: p.user.avatarUrl,
      })),
      messages: conversation.messages.map((m) => ({
        id: m.id,
        content: m.content,
        senderId: m.senderId,
        sender: m.sender,
        conversationId: m.conversationId,
        readAt: m.readAt,
        createdAt: m.createdAt,
      })),
    },
  });
}
