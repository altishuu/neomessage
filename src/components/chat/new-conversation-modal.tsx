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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<Map<string, User>>(
    new Map()
  );
  const [creating, setCreating] = useState(false);
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
        // Filter out already-selected users
        setResults(
          data.users.filter((u) => !selectedIds.has(u.id))
        );
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedIds.size]);

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

  // Toggle a user's selection for group creation
  const toggleSelection = useCallback((user: User) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(user.id)) {
        next.delete(user.id);
      } else {
        next.add(user.id);
      }
      return next;
    });
    setSelectedUsers((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) {
        next.delete(user.id);
      } else {
        next.set(user.id, user);
      }
      return next;
    });
    setQuery("");
  }, []);

  // Click on a user: if it's the only selection, create DM; otherwise toggle
  const handleUserClick = useCallback(
    async (user: User) => {
      if (selectedIds.size === 0) {
        // No selections yet — create DM directly
        setCreating(true);
        setError(null);
        try {
          const { conversation } = await createConversation(user.id);
          onConversationCreated(conversation);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to create conversation"
          );
        } finally {
          setCreating(false);
        }
      } else {
        toggleSelection(user);
      }
    },
    [selectedIds.size, toggleSelection, onConversationCreated]
  );

  // Remove a selected user chip
  const removeSelected = useCallback(
    (userId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      setSelectedUsers((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    },
    []
  );

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedUsers(new Map());
  }, []);

  // Create group conversation with all selected users
  const handleCreateGroup = useCallback(async () => {
    if (selectedIds.size < 2) return;
    setCreating(true);
    setError(null);
    try {
      const { conversation } = await createConversation(
        Array.from(selectedIds)
      );
      onConversationCreated(conversation);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create group"
      );
    } finally {
      setCreating(false);
    }
  }, [selectedIds, onConversationCreated]);

  const isGroupMode = selectedIds.size > 0;

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
            {isGroupMode ? "~$ New Group" : "~$ New Conversation"}
          </h2>
          <div className="flex items-center gap-2">
            {isGroupMode && (
              <button
                onClick={clearSelection}
                className="font-mono text-[10px] text-text-dim hover:text-text transition-colors"
              >
                [clear]
              </button>
            )}
            <button
              onClick={onClose}
              className="font-mono text-xs text-text-dim hover:text-text transition-colors"
            >
              [x]
            </button>
          </div>
        </div>

        {/* Selected users chips */}
        {isGroupMode && (
          <div className="px-4 pt-3 flex flex-wrap gap-1.5">
            {Array.from(selectedUsers.values()).map((user) => (
              <span
                key={user.id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-cyan/10 border border-cyan/30 rounded-sm"
              >
                <span className="font-mono text-[11px] text-cyan">
                  {user.username}
                </span>
                <button
                  onClick={() => removeSelected(user.id)}
                  className="text-cyan/60 hover:text-cyan transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isGroupMode
                ? "Search more users..."
                : "Search by username..."
            }
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
          ) : query.trim().length < 2 && !isGroupMode ? (
            <div className="flex items-center justify-center py-8">
              <p className="font-mono text-xs text-text-muted">
                Type at least 2 characters to search
              </p>
            </div>
          ) : results.length === 0 && query.trim().length >= 2 ? (
            <div className="flex items-center justify-center py-8">
              <p className="font-mono text-xs text-text-dim">
                ~$ no users found
              </p>
            </div>
          ) : isGroupMode ? (
            <div className="py-1">
              {results.length === 0 && query.trim().length < 2 ? (
                <div className="flex items-center justify-center py-8">
                  <p className="font-mono text-xs text-text-muted">
                    Search to add more users
                  </p>
                </div>
              ) : (
                results.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => toggleSelection(user)}
                    disabled={creating}
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
                    <span className="font-mono text-[10px] text-cyan">
                      + Add
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="py-1">
              {results.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleUserClick(user)}
                  disabled={creating === true}
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
                  {creating ? (
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
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="font-mono text-[10px] text-text-muted">
            {isGroupMode
              ? `${selectedIds.size} user${selectedIds.size !== 1 ? "s" : ""} selected`
              : "Click a user to start a DM"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {isGroupMode && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCreateGroup}
                disabled={creating || selectedIds.size < 2}
              >
                {creating ? "Creating..." : "Start Group"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
