"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  getProfile,
  updateProfile,
  uploadAvatar,
} from "@/lib/api";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/types";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type StatusMessage =
  | { type: "success"; text: string }
  | { type: "error"; text: string }
  | null;

export default function ProfilePage() {
  const router = useRouter();
  const { user: authUser } = useAuth();

  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Inline edit state
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  // Avatar upload
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Feedback
  const [status, setStatus] = useState<StatusMessage>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getProfile();
        if (!mounted) return;
        setProfile(data.user);
        setDisplayName(data.user.displayName ?? data.user.username);
      } catch (err) {
        if (!mounted) return;
        setFetchError(
          err instanceof Error ? err.message : "Failed to load profile"
        );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSaveDisplayName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === (profile?.displayName ?? profile?.username)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const data = await updateProfile({ displayName: trimmed });
      setProfile(data.user);
      setEditing(false);
      setStatus({ type: "success", text: "Display name updated" });
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (max 5 MB)
    if (file.size > 5 * 1024 * 1024) {
      setStatus({ type: "error", text: "Avatar must be under 5 MB" });
      return;
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setStatus({ type: "error", text: "Only image files are allowed" });
      return;
    }

    setUploading(true);
    setStatus(null);
    try {
      const data = await uploadAvatar(file);
      setProfile(data.user);
      setStatus({ type: "success", text: "Avatar updated" });
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setUploading(false);
      // Reset file input so same file can be re-selected
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-20 h-20 rounded-sm bg-surface-overlay animate-pulse" />
          <div className="h-4 w-32 rounded bg-surface-overlay animate-pulse" />
          <div className="h-3 w-48 rounded bg-surface-overlay animate-pulse" />
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (fetchError) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center px-4 max-w-sm">
          <p className="font-mono text-sm text-red mb-4">
            ~$ error: {fetchError}
          </p>
          <Button variant="secondary" onClick={() => router.push("/chat")}>
            Back to chat
          </Button>
        </div>
      </div>
    );
  }

  // ── Empty / no data guard ──
  if (!profile) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center px-4 max-w-sm">
          <p className="font-mono text-sm text-text-dim mb-4">
            ~$ profile not found
          </p>
          <Button variant="secondary" onClick={() => router.push("/chat")}>
            Back to chat
          </Button>
        </div>
      </div>
    );
  }

  // ── Profile view ──
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push("/chat")}
          className={cn(
            "flex items-center gap-1.5 font-mono text-xs text-text-dim",
            "hover:text-cyan transition-colors"
          )}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to chat
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Status toast */}
          {status && (
            <div
              className={cn(
                "mb-6 px-4 py-2 rounded-sm font-mono text-xs border",
                status.type === "success" &&
                  "bg-green/10 border-green/30 text-green",
                status.type === "error" && "bg-red/10 border-red/30 text-red"
              )}
            >
              {status.type === "success" ? "~$ " : "! "}
              {status.text}
            </div>
          )}

          <div className="flex flex-col items-center gap-6">
            {/* Avatar + upload */}
            <div className="relative group">
              <Avatar
                username={profile.displayName ?? profile.username}
                avatarUrl={profile.avatarUrl}
                size="lg"
                className="w-24 h-24 text-2xl"
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={cn(
                  "absolute inset-0 flex items-center justify-center rounded-sm",
                  "bg-surface/60 opacity-0 group-hover:opacity-100 transition-opacity",
                  "font-mono text-xs text-text cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus",
                  uploading && "opacity-100"
                )}
              >
                {uploading ? (
                  <span className="animate-pulse">Uploading...</span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    Change
                  </span>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>

            {/* Username */}
            <div className="text-center">
              <h1 className="font-mono text-lg font-bold text-cyan">
                @{profile.username}
              </h1>
              {profile.email && (
                <p className="font-mono text-xs text-text-dim mt-1">
                  {profile.email}
                </p>
              )}
            </div>

            {/* Joined date */}
            {profile.createdAt && (
              <p className="font-mono text-[11px] text-text-muted -mt-3">
                Joined {formatDate(profile.createdAt)}
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border my-6" />

          {/* Display name inline edit */}
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-text-dim block">
              Display Name
            </label>
            {editing ? (
              <div className="flex gap-2">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveDisplayName();
                    if (e.key === "Escape") {
                      setDisplayName(profile.displayName ?? profile.username);
                      setEditing(false);
                    }
                  }}
                  autoFocus
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveDisplayName}
                  disabled={saving}
                >
                  {saving ? "..." : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDisplayName(profile.displayName ?? profile.username);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-text">
                  {profile.displayName ?? profile.username}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                  className="text-text-dim hover:text-cyan"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                  Edit
                </Button>
              </div>
            )}
          </div>

          {/* Logout button at bottom */}
          <div className="mt-8 pt-6 border-t border-border">
            <Button
              variant="ghost"
              className="w-full text-red hover:bg-red/10"
              onClick={async () => {
                const { createClient } = await import(
                  "@/lib/supabase/client"
                );
                const supabase = createClient();
                await supabase.auth.signOut();
                router.push("/login");
              }}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Logout
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
