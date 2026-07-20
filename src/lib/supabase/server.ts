import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/types";

/**
 * Creates a Supabase client for use in **Server Components**, **Route Handlers**,
 * and **Server Actions**. Uses the cookie-based auth session from the request.
 *
 * Usage:
 * ```ts
 * // Server Component
 * const supabase = await createSupabaseServerClient();
 * const { data: { user } } = await supabase.auth.getUser();
 * const { data: conversations } = await supabase.from("conversations").select("*");
 * ```
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // `cookies().set()` throws in Route Handlers (Next.js 15) because
            // RequestCookies is read-only in that context. Silently ignore so
            // the request doesn't 500 — auth reads still work via getAll().
          }
        },
      },
    },
  );
}
