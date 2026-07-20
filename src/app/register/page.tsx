"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordStrength } from "@/components/ui/password-strength";

export default function RegisterPage() {
  const router = useRouter();
  const { user, loading, setUser } = useAuth();

  // Redirect to chat if already authenticated
  useEffect(() => {
    if (!loading && user) {
      router.replace("/chat");
    }
  }, [user, loading, router]);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error ?? "Registration failed");
      }

      if (json.user) {
        setUser(json.user);
      }
      router.push("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
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
            ┌─── neo‑register ───┐
          </p>
          <h1 className="font-mono text-lg font-bold text-cyan tracking-wider uppercase">
            NeoMessage
          </h1>
          <p className="font-mono text-xs text-text-dim mt-1">Create Account</p>
          <p className="font-mono text-xs text-text-muted mt-0.5">
            └────────────────────┘
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
            id="username"
            label="username"
            type="text"
            placeholder="cyber_user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />

          <Input
            id="password"
            label="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            showPasswordToggle
          />

          <PasswordStrength password={password} />

          <Input
            id="confirmPassword"
            label="confirm password"
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
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
            {submitting ? "~$ creating account..." : "~$ create account"}
          </Button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center font-mono text-xs text-text-dim">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-cyan hover:text-cyan/80 underline underline-offset-2"
          >
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
