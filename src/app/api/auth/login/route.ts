import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/middleware";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    if (typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 },
      );
    }

    const { supabase, supabaseResponse, pendingCookies } =
      createServerSupabaseClient(request);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email as string,
      password: password as string,
    });

    if (error) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    // Fetch the user's profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id, user_id, username, display_name, avatar_url, created_at")
      .eq("user_id", data.user.id)
      .single();

    const response = NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        username: profile?.username ?? "",
        displayName: profile?.display_name ?? "",
        avatarUrl: profile?.avatar_url ?? null,
        createdAt: profile?.created_at ?? data.user.created_at,
      },
    });

    // Apply auth cookies onto the actual response, preserving options
    // (httpOnly: false is critical so the browser client can read the
    // auth token for Realtime WebSocket connections)
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options);
    }

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
