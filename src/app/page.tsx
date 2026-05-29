"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

/* ── Floating geometric decoration ── */
function DecorativeGrid() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden -z-10">
      {/* Scan lines */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 229, 255, 0.08) 2px, rgba(0, 229, 255, 0.08) 4px)",
          backgroundSize: "100% 4px",
        }}
      />
      {/* Corner glow */}
      <div className="absolute -top-40 -right-40 w-80 h-80 bg-cyan/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-magenta/5 rounded-full blur-3xl" />
    </div>
  );
}

/* ── Feature card ── */
function FeatureCard({
  icon,
  label,
  desc,
}: {
  icon: string;
  label: string;
  desc: string;
}) {
  return (
    <div className="group border border-border bg-surface-raised rounded-sm p-5 transition-all duration-200 hover:border-cyan/40 hover:bg-surface-overlay">
      <p className="font-mono text-lg mb-2">{icon}</p>
      <h3 className="font-mono text-sm font-bold text-cyan uppercase tracking-wider mb-1.5">
        {label}
      </h3>
      <p className="font-mono text-xs text-text-dim leading-relaxed">{desc}</p>
    </div>
  );
}

/* ── Landing page ── */
export default function LandingPage() {
  const { user, loading } = useAuth();

  return (
    <div className="flex-1 flex flex-col bg-surface relative">
      <DecorativeGrid />

      {/* ── Nav bar ── */}
      <nav className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border">
        <Link
          href="/"
          className="font-mono text-sm font-bold text-cyan tracking-wider uppercase hover:text-cyan/80 transition-colors"
        >
          NeoMessage
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          {loading ? (
            <span className="font-mono text-xs text-text-muted animate-pulse">
              ~$ loading...
            </span>
          ) : user ? (
            <>
              <span className="font-mono text-xs text-text-dim hidden sm:inline">
                [{user.username || user.email}]
              </span>
              <Link href="/chat">
                <Button variant="secondary" size="sm">
                  ~$ chat
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="secondary" size="sm">
                  ~$ login
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="primary" size="sm">
                  ~$ register
                </Button>
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="flex-1 flex items-center justify-center px-4 py-16 sm:py-24">
        <div className="max-w-2xl mx-auto text-center">
          {/* Terminal header */}
          <div className="mb-6">
            <p className="font-mono text-[10px] sm:text-xs text-text-muted mb-1">
              ┌─────────────────────────────────────────┐
            </p>
            <p className="font-mono text-[10px] sm:text-xs text-text-muted">
              │
              <span className="text-cyan mx-1">~$</span>
              <span className="text-text-dim">cat /etc/neomessage</span>
              <span className="invisible"> │</span>
            </p>
            <p className="font-mono text-[10px] sm:text-xs text-text-muted">
              └─────────────────────────────────────────┘
            </p>
          </div>

          {/* App name */}
          <h1 className="font-mono text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.15em] uppercase mb-4">
            <span className="text-cyan">Neo</span>
            <span className="text-green">Message</span>
          </h1>

          {/* Tagline */}
          <p className="font-mono text-sm sm:text-base text-text-dim mb-2 max-w-lg mx-auto leading-relaxed">
            A terminal-cyber messenger built for the connected underground.
          </p>
          <p className="font-mono text-xs text-text-muted mb-8">
            real-time · encrypted · open source
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            {loading ? (
              <div className="h-10 w-48 bg-surface-raised border border-border rounded-sm animate-pulse" />
            ) : user ? (
              <Link href="/chat">
                <Button variant="primary" size="lg">
                  ~$ enter chat
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/register" className="w-full sm:w-auto">
                  <Button variant="primary" size="lg" className="w-full sm:w-auto">
                    ~$ get started
                  </Button>
                </Link>
                <Link href="/login" className="w-full sm:w-auto">
                  <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                    ~$ sign in
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* Terminal output decoration */}
          <div className="mt-12 font-mono text-[10px] sm:text-xs text-text-muted leading-relaxed">
            <p>
              <span className="text-green">✓</span> supabase connected
            </p>
            <p>
              <span className="text-green">✓</span> realtime ready
            </p>
            <p>
              <span className="text-cyan">~$</span> awaiting input...
              <span className="inline-block w-2 h-4 bg-cyan/70 ml-0.5 animate-pulse align-middle" />
            </p>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="border-t border-border px-4 sm:px-8 py-12 sm:py-16">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[10px] text-text-muted text-center mb-1">
            ─── features ───
          </p>
          <h2 className="font-mono text-lg sm:text-xl font-bold text-cyan text-center tracking-wider uppercase mb-8">
            Built for the modern terminal
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FeatureCard
              icon="⚡"
              label="Real-time"
              desc="Messages delivered instantly via Supabase Realtime subscriptions. No polling, no latency."
            />
            <FeatureCard
              icon="🖥️"
              label="Cyberpunk UI"
              desc="Terminal-cyber aesthetic with monospace typography, scan lines, and a dark neon palette."
            />
            <FeatureCard
              icon="🗄️"
              label="Supabase"
              desc="Postgres-backed auth, database, and storage. Secure, scalable, and open source."
            />
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-4 sm:px-8 py-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-mono text-[10px] sm:text-xs text-text-muted order-2 sm:order-1">
            © {new Date().getFullYear()}{" "}
            <span className="text-cyan">NeoMessage</span> — built with{" "}
            <span className="text-magenta">♥</span>
          </p>
          <nav className="flex items-center gap-4 order-1 sm:order-2">
            <a
              href="https://github.com/altishuu/neomessage"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] sm:text-xs text-text-dim hover:text-cyan transition-colors"
            >
              [github]
            </a>
            <Link
              href="/chat"
              className="font-mono text-[10px] sm:text-xs text-text-dim hover:text-cyan transition-colors"
            >
              [chat]
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
