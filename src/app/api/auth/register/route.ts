import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, username, password } = body;

    if (!email || !username || !password) {
      return NextResponse.json(
        { error: "Email, username, and password are required" },
        { status: 400 }
      );
    }

    if (
      typeof email !== "string" ||
      typeof username !== "string" ||
      typeof password !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 30) {
      return NextResponse.json(
        { error: "Username must be between 3 and 30 characters" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check for existing username using an anon client (public reads allowed by RLS)
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: existingProfile } = await anonClient
      .from("user_profiles")
      .select("username")
      .eq("username", username)
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 }
      );
    }

    // Create the auth user via Supabase Auth
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          display_name: username,
        },
      },
    });

    if (error) {
      // Check for duplicate email
      if (error.message?.includes("already registered") || error.status === 422) {
        return NextResponse.json(
          { error: "Email already in use" },
          { status: 409 }
        );
      }
      console.error("Signup error:", error);
      return NextResponse.json(
        { error: error.message || "Registration failed" },
        { status: 400 }
      );
    }

    if (!data.user) {
      return NextResponse.json(
        { error: "Registration failed" },
        { status: 500 }
      );
    }

    // If the trigger auto-creates a profile, update it with the chosen username.
    // Otherwise (or as a safety net), upsert the profile ourselves.
    const { error: upsertError } = await supabase
      .from("user_profiles")
      .upsert(
        {
          user_id: data.user.id,
          username,
          display_name: username,
        },
        { onConflict: "user_id", ignoreDuplicates: false }
      );

    if (upsertError) {
      console.error("Profile upsert error:", upsertError);
      // Non-fatal — the trigger should have created a profile already
    }

    // Build the response
    const response = NextResponse.json(
      {
        user: {
          id: data.user.id,
          email: data.user.email,
          username,
          displayName: username,
          avatarUrl: null,
          createdAt: data.user.created_at,
        },
      },
      { status: 201 }
    );

    // Propagate auth cookies from the intermediate response when session exists
    const setCookieHeaders = supabaseResponse.headers.getSetCookie();
    for (const cookie of setCookieHeaders) {
      response.headers.append("Set-Cookie", cookie);
    }

    return response;
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
