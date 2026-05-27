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

  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const users = await prisma.user.findMany({
    where: {
      AND: [
        { id: { not: userId } },
        {
          OR: [
            { username: { contains: q } },
            { email: { contains: q } },
          ],
        },
      ],
    },
    select: {
      id: true,
      email: true,
      username: true,
      avatarUrl: true,
    },
    take: 20,
  });

  return NextResponse.json({ users });
}
