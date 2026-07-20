import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/types";

/**
 * Create a Supabase server client with cookie handling for Next.js middleware
 * and API routes.
 *
 * Handles reading cookies from the request and writing them back to the response
 * so auth sessions are properly maintained across server-side operations.
 */
export function createServerSupabaseClient(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  return { supabase, supabaseResponse };
}

/**
 * Apply cookies from a supabase server client response's cookie jar
 * onto the actual API response. This is needed because Set-Cookie
 * headers on the intermediate NextResponse are not automatically
 * forwarded — we must copy them explicitly.
 */
export function applyAuthCookies(
  supabaseResponse: Awaited<ReturnType<typeof createServerSupabaseClient>>['supabaseResponse'],
  response: NextResponse,
) {
  const setCookieHeaders = supabaseResponse.headers.getSetCookie();
  for (const cookie of setCookieHeaders) {
    response.headers.append("Set-Cookie", cookie);
  }
}

/**
 * Next.js middleware helper for Supabase auth session management.
 *
 * Refreshes the Supabase auth session on every request and returns
 * both the supabase client and the response, so the root middleware
 * can perform its own route protection logic.
 */
export async function updateSession(request: NextRequest) {
  const { supabase, supabaseResponse } = createServerSupabaseClient(request);

  // Refresh the auth session — this also validates the session's freshness.
  // The result propagates into the response cookies so subsequent requests
  // carry the refreshed session.
  await supabase.auth.getUser();

  return { supabase, supabaseResponse };
}
