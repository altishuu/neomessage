"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { searchMessages } from "@/lib/api";
import type { Conversation } from "@/lib/types";

interface SearchResult {
  id: string;
  conversationId: string;
  senderId: string | null;
  content: string;
  createdAt: string;
  rank: number;
  sender: { id: string; username: string; avatarUrl: string | null } | null;
}

interface SearchPanelProps {
  conversations: Conversation[];
  activeId?: string;
  onClose: () => void;
}

export function SearchPanel({
  conversations,
  activeId,
  onClose,
}: SearchPanelProps) {
  const [convFilter, setConvFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchText.trim().length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const targetConv =
          convFilter === "all" ? null : convFilter;
        if (targetConv) {
          const data = await searchMessages(targetConv, searchText.trim());
          setResults(data.messages);
        } else {
          // Search all conversations — run in parallel
          const allResults = await Promise.all(
            conversations.map(async (conv) => {
              try {
                const data = await searchMessages(
                  conv.id,
                  searchText.trim()
                );
                return data.messages;
              } catch {
                return [];
              }
            })
          );
          setResults(
            allResults
              .flat()
              .sort((a, b) => b.rank - a.rank)
              .slice(0, 50)
          );
        }
        setShowResults(true);
      } catch {
        setResults([]);
        setShowResults(true);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchText, convFilter, conversations]);

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      onClose();
      router.push(`/chat/${result.conversationId}`);
    },
    [onClose, router]
  );

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="border-b border-border bg-surface">
      {/* Search input */}
      <div className="px-3 py-2">
        <div className="flex gap-2 items-center">
          <input
            ref={inputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search messages..."
            className="flex-1 bg-surface-overlay border border-border rounded-sm px-3 py-1.5 font-mono text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-border-focus transition-colors"
          />
        </div>
        {/* Conversation filter */}
        <div className="flex items-center gap-1.5 mt-2">
          <button
            onClick={() => setConvFilter("all")}
            className={cn(
              "font-mono text-[10px] px-2 py-0.5 rounded-sm transition-colors",
              convFilter === "all"
                ? "bg-cyan/10 text-cyan"
                : "text-text-muted hover:text-text-dim"
            )}
          >
            all
          </button>
          {conversations.slice(0, 6).map((conv) => {
            const label =
              conv.title ||
              conv.participants.map((p) => p.username).join(", ").slice(0, 20);
            return (
              <button
                key={conv.id}
                onClick={() => setConvFilter(conv.id)}
                className={cn(
                  "font-mono text-[10px] px-2 py-0.5 rounded-sm truncate max-w-[80px] transition-colors",
                  convFilter === conv.id
                    ? "bg-cyan/10 text-cyan"
                    : "text-text-muted hover:text-text-dim"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results */}
      {searching && (
        <div className="px-4 py-3">
          <p className="font-mono text-[10px] text-text-dim animate-pulse">
            Searching...
          </p>
        </div>
      )}
      {showResults && !searching && searchText.trim().length >= 2 && (
        <div className="max-h-48 overflow-y-auto border-t border-border">
          {results.length === 0 ? (
            <div className="px-4 py-3">
              <p className="font-mono text-[10px] text-text-muted">
                ~$ no results for &quot;{searchText}&quot;
              </p>
            </div>
          ) : (
            results.map((result) => {
              const conv = conversations.find(
                (c) => c.id === result.conversationId
              );
              const convLabel = conv
                ? conv.title ||
                  conv.participants.map((p) => p.username).join(", ")
                : "unknown";
              return (
                <button
                  key={result.id}
                  onClick={() => handleSelectResult(result)}
                  className={cn(
                    "w-full flex flex-col gap-0.5 px-4 py-2 text-left transition-colors duration-150",
                    "hover:bg-surface-raised border-b border-border/50 last:border-b-0"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-cyan truncate min-w-0">
                      {result.sender?.username ?? "system"}
                    </span>
                    <span className="font-mono text-[9px] text-text-muted flex-shrink-0">
                      {new Date(result.createdAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-text-dim truncate">
                    {result.content}
                  </p>
                  <span className="font-mono text-[9px] text-text-muted">
                    in: {convLabel}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
