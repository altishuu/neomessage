"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { createConversation, searchUsers } from "@/lib/api";
import type { User, Conversation } from "@/lib/types";

interface NewConversationModalProps {
  onClose: () => void;
  onConversationCreated: (conversation: Conversation) => void;
}

export function NewConversationModal({
  onClose,
  onConversationCreated,
}: NewConversationModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search users with debounce
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchUsers(query.trim());
        setResults(data.users);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose]
  );

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSelectUser = useCallback(
    async (userId: string) => {
      setCreating(userId);
      setError(null);
      try {
        const { conversation } = await createConversation(userId);
        onConversationCreated(conversation);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create conversation"
        );
      } finally {
        setCreating(null);
      }
    },
    [onConversationCreated]
  );

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm"
    >
      <div className="w-full max-w-md bg-surface-raised border border-border rounded-sm shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-mono text-sm font-bold text-cyan uppercase tracking-wider">
            ~$ New Conversation
          </h2>
          <button
            onClick={onClose}
            className="font-mono text-xs text-text-dim hover:text-text transition-colors"
          >
            [x]
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username..."
            className={cn(
              "w-full bg-surface border border-border rounded-sm px-3 py-2.5",
              "font-mono text-sm text-text placeholder:text-text-muted",
              "focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/30",
              "transition-colors duration-150"
            )}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 pb-2">
            <p className="font-mono text-xs text-red">{error}</p>
          </div>
        )}

        {/* Results */}
        <div className="max-h-64 overflow-y-auto border-t border-border">
          {searching ? (
            <div className="flex items-center justify-center py-8">
              <p className="font-mono text-xs text-text-dim animate-pulse">
                Searching...
              </p>
            </div>
          ) : query.trim().length < 2 ? (
            <div className="flex items-center justify-center py-8">
              <p className="font-mono text-xs text-text-muted">
                Type at least 2 characters to search
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="font-mono text-xs text-text-dim">
                ~$ no users found
              </p>
            </div>
          ) : (
            <div className="py-1">
              {results.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectUser(user.id)}
                  disabled={creating === user.id}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150",
                    "hover:bg-surface border-b border-border/50 last:border-b-0",
                    "disabled:opacity-40 disabled:cursor-not-allowed"
                  )}
                >
                  <Avatar
                    username={user.username}
                    avatarUrl={user.avatarUrl}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm text-text">
                      {user.username}
                    </span>
                    <p className="font-mono text-xs text-text-dim truncate mt-0.5">
                      {user.email}
                    </p>
                  </div>
                  {creating === user.id ? (
                    <span className="font-mono text-[10px] text-cyan animate-pulse">
                      Creating...
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-text-muted hover:text-cyan">
                      + Chat
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-4 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
