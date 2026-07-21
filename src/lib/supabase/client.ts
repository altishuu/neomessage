import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Create a Supabase client for use in Client Components and hooks.
 *
 * Returns a singleton instance so all hooks (auth, realtime, etc.)
 * share the same client with the same in-memory auth session.
 *
 * Usage:
 * ```tsx
 * const supabase = createClient();
 * const { data: { user } } = await supabase.auth.getUser();
 * ```
 */
export function createClient() {
  if (client) return client;
  client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}

/**
 * Alias with a more descriptive name. Same as createClient().
 */
export const createSupabaseBrowserClient = createClient;
