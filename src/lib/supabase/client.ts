import { createBrowserClient } from "@supabase/ssr";

/**
 * Create a Supabase client for use in Client Components and hooks.
 *
 * This uses the browser's built-in cookie storage for auth session
 * management. Call this once per component or use a singleton pattern.
 *
 * Usage:
 * ```tsx
 * const supabase = createClient();
 * const { data: { user } } = await supabase.auth.getUser();
 * ```
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Alias with a more descriptive name. Same as createClient().
 */
export const createSupabaseBrowserClient = createClient;
