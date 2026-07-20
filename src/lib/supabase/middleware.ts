import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/types";

/**
 * Cookie descriptor as returned by the supabase SSR cookie callbacks.
 */
export interface PendingCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

/**
 * Create a Supabase server client with cookie handling for Next.js middleware
 * and API routes.
 *
 * In addition to the supabase client and an intermediate response (used by
 * the middleware), this also returns a `pendingCookies` array that collects
 * all cookies the supabase library wants to set. API routes can then apply
 * these cookies onto their own final response via `applyPendingCookies()`.
 */
export function createServerSupabaseClient(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const pendingCookies: PendingCookie[] = [];

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          const optsArray = cookiesToSet.map(
            ({ name, value, options }) => ({ name, value, options }),
          );

          // Update the request cookie jar so subsequent getCookie readers
          // see the updated values.
          optsArray.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          // Re-create the intermediate response (for middleware use).
          supabaseResponse = NextResponse.next({ request });
          optsArray.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );

          // Collect every cookie so API routes can apply them to their
          // own response (where NextResponse.next() cookies are not
          // automatically serialised).
          pendingCookies.push(...optsArray);
        },
      },
    },
  );

  return { supabase, supabaseResponse, pendingCookies };
}

/**
 * Apply cookies that were collected during Supabase operations onto a
 * response that will actually be returned by an API route.
 */
export function applyPendingCookies(
  response: NextResponse,
  pendingCookies: PendingCookie[],
) {
  for (const { name, value } of pendingCookies) {
    response.cookies.set(name, value);
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
