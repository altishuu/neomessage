import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/middleware";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, username, password } = body;

    if (!email || !username || !password) {
      return NextResponse.json(
        { error: "Email, username, and password are required" },
        { status: 400 },
      );
    }

    if (
      typeof email !== "string" ||
      typeof username !== "string" ||
      typeof password !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 },
      );
    }

    if (username.length < 3 || username.length > 30) {
      return NextResponse.json(
        { error: "Username must be between 3 and 30 characters" },
        { status: 400 },
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    // Check for existing username using an anon client against the public view
    // (public_user_profiles is accessible to both anon and authenticated roles)
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { data: existingProfile } = await anonClient
      .from("public_user_profiles")
      .select("username")
      .eq("username", username)
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 },
      );
    }

    // Create the auth user via Supabase Auth
    const { supabase, supabaseResponse, pendingCookies } =
      createServerSupabaseClient(request);

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
          { status: 409 },
        );
      }
      console.error("Signup error:", error);
      return NextResponse.json(
        { error: error.message || "Registration failed" },
        { status: 400 },
      );
    }

    if (!data.user) {
      return NextResponse.json(
        { error: "Registration failed" },
        { status: 500 },
      );
    }

    // Use service_role client for the profile upsert to guard against cases where
    // email confirmation is enabled and no session cookie exists yet.
    // The trigger should have created a profile, so this is a safety net.
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );

    const { error: upsertError } = await adminClient
      .from("user_profiles")
      .upsert(
        {
          user_id: data.user.id,
          username,
          display_name: username,
        },
        { onConflict: "user_id", ignoreDuplicates: false },
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
      { status: 201 },
    );

    // Apply auth cookies onto the actual response, preserving options
    // (httpOnly: false is critical so the browser client can read the
    // auth token for Realtime WebSocket connections)
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options);
    }

    return response;
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
