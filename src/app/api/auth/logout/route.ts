import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ── DELETE /api/auth/logout ──────────────────────────────────────────────────
// Signs out the current user by clearing the Supabase auth session and cookies.

export async function DELETE(_request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.warn("Supabase signOut warning:", error.message);
    }

    const response = NextResponse.json({ success: true });

    // Clear any leftover Supabase auth cookies
    response.cookies.set("sb-auth-token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("DELETE /api/auth/logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
