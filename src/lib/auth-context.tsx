"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@/lib/types";

/** Map a Supabase user to our app's User type, merging with profile data. */
function mapUser(
  supabaseUser: import("@supabase/supabase-js").User,
  profile?: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    avatar_updated_at: string | null;
  } | null,
): User {
  const username =
    profile?.username ??
    (supabaseUser.user_metadata?.username as string) ??
    "";
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? "",
    username,
    displayName:
      profile?.display_name ??
      (supabaseUser.user_metadata?.display_name as string) ??
      username,
    avatarUrl:
      profile?.avatar_url ??
      (supabaseUser.user_metadata?.avatar_url as string | null) ??
      null,
    avatarUpdatedAt: profile?.avatar_updated_at ?? null,
  };
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  error: null,
  refresh: async () => {},
  setUser: () => {},
});

/**
 * Fetch the user_profiles row for a given auth user ID.
 * Returns null silently on error / missing row.
 */
async function fetchProfile(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data } = await supabase
    .from("user_profiles")
    .select("username, display_name, avatar_url, avatar_updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user: supabaseUser },
        error: getUserError,
      } = await supabase.auth.getUser();

      if (getUserError) throw getUserError;

      if (supabaseUser) {
        // Fetch profile data from user_profiles table (source of truth for avatar, display name)
        const profile = await fetchProfile(supabase, supabaseUser.id);
        setUser(mapUser(supabaseUser, profile));
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
      setError(
        err instanceof Error ? err.message : "Failed to load user",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    // Fetch initial user
    supabase.auth.getUser().then(async ({ data, error: getUserError }) => {
      if (!mounted) return;
      if (getUserError) {
        setError(getUserError.message);
      } else if (data.user) {
        const profile = await fetchProfile(supabase, data.user.id);
        if (mounted) {
          setUser(mapUser(data.user, profile));
        }
      }
      if (mounted) setLoading(false);
    });

    // Listen for auth state changes (login / logout / token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        // Fire-and-forget profile fetch — don't block UI on this
        fetchProfile(supabase, session.user.id).then((profile) => {
          if (mounted) {
            setUser(mapUser(session.user, profile));
          }
        });
      } else {
        setUser(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
