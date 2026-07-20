"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, setUser } = useAuth();

  // Redirect to chat if already authenticated
  useEffect(() => {
    if (!loading && user) {
      router.replace("/chat");
    }
  }, [user, loading, router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error ?? "Login failed");
      }

      if (json.user) {
        setUser(json.user);
      }
      router.push("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-surface">
      <div className="w-full max-w-sm mx-auto px-4">
        {/* Terminal header */}
        <div className="mb-8 text-center">
          <p className="font-mono text-xs text-text-muted mb-1">
            ┌─── neo‑login ───┐
          </p>
          <h1 className="font-mono text-lg font-bold text-cyan tracking-wider uppercase">
            NeoMessage
          </h1>
          <p className="font-mono text-xs text-text-dim mt-1">Authenticate</p>
          <p className="font-mono text-xs text-text-muted mt-0.5">
            └──────────────────┘
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="email"
            label="email"
            type="email"
            placeholder="user@neomessage.io"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <Input
            id="password"
            label="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            showPasswordToggle
          />

          {error && (
            <p className="font-mono text-xs text-red text-center">
              [error] {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? "~$ authenticating..." : "~$ login"}
          </Button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center font-mono text-xs text-text-dim">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="text-cyan hover:text-cyan/80 underline underline-offset-2"
          >
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
