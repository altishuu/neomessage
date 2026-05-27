import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getUserIdFromToken(token);
  if (!userId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { conversationId, content } = body;

    if (!conversationId || !content) {
      return NextResponse.json(
        { error: "conversationId and content are required" },
        { status: 400 }
      );
    }

    if (typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { error: "Content must be a non-empty string" },
        { status: 400 }
      );
    }

    // Verify sender is a participant
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });

    if (!participant) {
      return NextResponse.json(
        { error: "You are not a participant of this conversation" },
        { status: 403 }
      );
    }

    const message = await prisma.message.create({
      data: {
        content: content.trim(),
        conversationId,
        senderId: userId,
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
    });

    // Update conversation's updatedAt timestamp
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json(
      {
        message: {
          id: message.id,
          content: message.content,
          senderId: message.senderId,
          sender: message.sender,
          conversationId: message.conversationId,
          readAt: message.readAt,
          createdAt: message.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Send message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
