import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromToken } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getUserIdFromToken(token);
  if (!userId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      participants: {
        some: { userId },
      },
    },
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
        take: 1,
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
    orderBy: { updatedAt: "desc" },
  });

  const result = conversations.map((conv) => ({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    participants: conv.participants.map((p) => ({
      id: p.user.id,
      username: p.user.username,
      email: p.user.email,
      avatarUrl: p.user.avatarUrl,
    })),
    lastMessage: conv.messages[0] || null,
  }));

  return NextResponse.json({ conversations: result });
}

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
    const { participantId, participantIds } = body;

    let allParticipantIds: string[];

    if (participantIds && Array.isArray(participantIds)) {
      allParticipantIds = Array.from(new Set([userId, ...participantIds]));
    } else if (participantId) {
      allParticipantIds = [userId, participantId];
    } else {
      return NextResponse.json(
        { error: "participantId or participantIds is required" },
        { status: 400 }
      );
    }

    // Validate all participants exist
    const users = await prisma.user.findMany({
      where: { id: { in: allParticipantIds } },
    });

    if (users.length !== allParticipantIds.length) {
      return NextResponse.json(
        { error: "One or more participants not found" },
        { status: 404 }
      );
    }

    // For 2-person chats, check if conversation already exists
    if (allParticipantIds.length === 2) {
      const existingConversation = await prisma.conversation.findFirst({
        where: {
          AND: [
            { participants: { some: { userId: allParticipantIds[0] } } },
            { participants: { some: { userId: allParticipantIds[1] } } },
          ],
          // Only match 1-on-1 conversations (exactly 2 participants)
          participants: {
            every: {
              userId: { in: allParticipantIds },
            },
          },
        },
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
        },
      });

      if (existingConversation) {
        return NextResponse.json({
          conversation: {
            id: existingConversation.id,
            title: existingConversation.title,
            createdAt: existingConversation.createdAt,
            updatedAt: existingConversation.updatedAt,
            participants: existingConversation.participants.map((p) => ({
              id: p.user.id,
              username: p.user.username,
              email: p.user.email,
              avatarUrl: p.user.avatarUrl,
            })),
            lastMessage: null,
          },
        });
      }
    }

    const conversation = await prisma.conversation.create({
      data: {
        participants: {
          create: allParticipantIds.map((id) => ({
            userId: id,
          })),
        },
      },
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
      },
    });

    return NextResponse.json(
      {
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
