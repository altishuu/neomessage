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

/** Map a Supabase user to our app's User type. */
function mapUser(
  supabaseUser: import("@supabase/supabase-js").User
): User {
  const username =
    (supabaseUser.user_metadata?.username as string) ?? "";
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? "",
    username,
    displayName:
      (supabaseUser.user_metadata?.display_name as string) ?? username,
    avatarUrl:
      (supabaseUser.user_metadata?.avatar_url as string | null) ?? null,
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
      setUser(supabaseUser ? mapUser(supabaseUser) : null);
    } catch (err) {
      setUser(null);
      setError(
        err instanceof Error ? err.message : "Failed to load user"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    // Fetch initial user
    supabase.auth.getUser().then(({ data, error: getUserError }) => {
      if (!mounted) return;
      if (getUserError) {
        setError(getUserError.message);
      } else if (data.user) {
        setUser(mapUser(data.user));
      }
      setLoading(false);
    });

    // Listen for auth state changes (login / logout / token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(mapUser(session.user));
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
