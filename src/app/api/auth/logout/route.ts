import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/middleware";

// ── DELETE /api/auth/logout ──────────────────────────────────────────────────
// Signs out the current user by clearing the Supabase auth session and cookies.
// Uses the middleware-compatible client so cookie clearing propagates to the
// response object properly (the server-only client can't write response cookies).

export async function DELETE(request: NextRequest) {
  try {
    const { supabase, supabaseResponse } =
      createServerSupabaseClient(request);

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.warn("Supabase signOut warning:", error.message);
    }

    const response = NextResponse.json({ success: true });

    // Propagate any Set-Cookie headers from the intermediate response
    // (signOut clears the auth cookies via setAll() in the client config)
    const setCookieHeaders = supabaseResponse.headers.getSetCookie();
    for (const cookie of setCookieHeaders) {
      response.headers.append("Set-Cookie", cookie);
    }

    return response;
  } catch (error) {
    console.error("DELETE /api/auth/logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
