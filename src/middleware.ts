import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, supabaseResponse } = await updateSession(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Auth pages — redirect to chat if already logged in
  const authPaths = ["/login", "/register"];
  if (authPaths.includes(pathname)) {
    if (user) {
      return NextResponse.redirect(new URL("/chat", request.url));
    }
    return supabaseResponse;
  }

  // Protected routes — redirect to login if not authenticated
  if (
    pathname.startsWith("/chat") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/api/messages") ||
    pathname.startsWith("/api/conversations") ||
    pathname.startsWith("/api/users") ||
    pathname.startsWith("/api/auth/me") ||
    pathname.startsWith("/api/profile")
  ) {
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/chat/:path*",
    "/login",
    "/register",
    "/profile",
    "/api/messages/:path*",
    "/api/conversations/:path*",
    "/api/users/:path*",
    "/api/auth/me",
    "/api/profile/:path*",
  ],
};
