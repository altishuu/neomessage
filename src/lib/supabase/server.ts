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
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );
}
