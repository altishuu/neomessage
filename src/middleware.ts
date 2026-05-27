import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET!
);

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  const { pathname } = request.nextUrl;

  // Auth pages — redirect to chat if already logged in
  const authPaths = ["/login", "/register"];
  if (authPaths.includes(pathname)) {
    if (token) {
      try {
        await jwtVerify(token, JWT_SECRET);
        return NextResponse.redirect(new URL("/chat", request.url));
      } catch {
        // Token invalid, allow access to auth pages
      }
    }
    return NextResponse.next();
  }

  // Protected routes — redirect to login if not authenticated
  if (pathname.startsWith("/chat") || pathname.startsWith("/api/messages") || pathname.startsWith("/api/conversations")) {
    if (!token) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", request.url));
    }

    try {
      await jwtVerify(token, JWT_SECRET);
      return NextResponse.next();
    } catch {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const resp = NextResponse.redirect(new URL("/login", request.url));
      resp.cookies.delete("token");
      return resp;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/chat/:path*", "/login", "/register", "/api/messages/:path*", "/api/conversations/:path*", "/api/users/:path*", "/api/auth/me", "/api/sse"],
};
