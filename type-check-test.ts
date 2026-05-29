// Type check: Database generic resolution
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

async function test() {
  const supabase = createServerClient<Database>(
    "https://test.supabase.co",
    "test-key",
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  );

  // Test table access
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("*");

  // @ts-expect-error — "nonexistent" table should not exist
  const { data: bad } = await supabase.from("nonexistent").select("*");

  // Test column access
  if (profiles && profiles[0]) {
    const username: string = profiles[0].username;
    console.log(username);
  }
}
