"use client";

import { useState, useRef, useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Message, Reaction } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeReactions } from "@/lib/hooks/use-realtime-reactions";
import { MessageActions } from "./message-actions";
import { Virtuoso } from "react-virtuoso";
import {
  FileText,
  Download,
  Maximize2,
  X,
} from "lucide-react";

interface MessageListProps {
  messages: Message[];
  loading?: boolean;
  typingUsers?: string[];
  conversationId: string;
}

// ── Reaction helpers ────────────────────────────────────────────────────

interface ReactionGroup {
  emoji: string;
  count: number;
  hasReacted: boolean;
}

function groupReactions(
  reactions: Reaction[],
  currentUserId: string,
): ReactionGroup[] {
  const map = new Map<string, { count: number; hasReacted: boolean }>();

  for (const r of reactions) {
    const entry = map.get(r.reaction) ?? { count: 0, hasReacted: false };
    entry.count++;
    if (r.userId === currentUserId) entry.hasReacted = true;
    map.set(r.reaction, entry);
  }

  return Array.from(map.entries())
    .map(([emoji, data]) => ({ emoji, ...data }))
    .sort((a, b) => b.count - a.count);
}

async function toggleReaction(
  messageId: string,
  emoji: string,
  reactions: Reaction[],
  currentUserId: string,
): Promise<void> {
  const existing = reactions.find(
    (r) => r.userId === currentUserId && r.reaction === emoji,
  );

  if (existing) {
    await fetch(`/api/messages/${messageId}/reactions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction: emoji }),
    });
  } else {
    await fetch(`/api/messages/${messageId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction: emoji }),
    });
  }
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮"];

function MessageSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-2 animate-pulse">
      <div className="w-8 h-8 rounded-sm bg-surface-overlay flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-20 bg-surface-overlay rounded" />
        <div className="h-4 w-48 bg-surface-overlay rounded" />
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  loading,
  typingUsers = [],
  conversationId,
}: MessageListProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Derive message IDs for the reactions hook
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const { getMessageReactions } = useRealtimeReactions(
    conversationId,
    messageIds,
  );

  const handleEdit = (msg: Message) => {
    setEditingId(msg.id);
    setIsEditing(true);
    setEditContent(msg.content);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleDelete = async (msg: Message) => {
    if (confirm("Delete this message?")) {
      await fetch(`/api/messages/${msg.id}`, { method: "DELETE" });
    }
  };

  const handleSave = async (msg: Message) => {
    await fetch(`/api/messages/${msg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent }),
    });
    setIsEditing(false);
    setEditingId(null);
  };

  const othersTyping = typingUsers.filter((tu) => tu !== user?.id);

  // ── Loading state ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <MessageSkeleton key={i} />
        ))}
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-text-dim text-sm">
            ~$ No messages yet
          </p>
          <p className="font-mono text-text-muted text-xs mt-1">
            Send a message to start the conversation
          </p>
        </div>
      </div>
    );
  }

  // ── Message item renderer ──────────────────────────────────────────

  const renderMessage = (_index: number, msg: Message) => {
    const isMine = msg.senderId === user?.id;
    const isDeleted = !msg.content && !msg.type;
    const msgReactions = getMessageReactions(msg.id);
    const reactionGroups = groupReactions(msgReactions, user?.id ?? "");

    return (
      <div
        key={msg.id}
        className={cn(
          "flex items-start gap-3 px-4 py-2 group",
          isMine ? "flex-row-reverse" : "flex-row",
        )}
      >
        {isMine && !isDeleted && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <MessageActions
              onEdit={() => handleEdit(msg)}
              onDelete={() => handleDelete(msg)}
            />
          </div>
        )}

        <div
          className={cn(
            "max-w-[70%] min-w-[100px] rounded-sm px-3 py-2 relative",
            isMine
              ? "bg-magenta/10 border border-magenta/30"
              : "bg-surface-raised border border-border",
            isDeleted && "opacity-50 italic",
          )}
        >
          {/* Sender + timestamp */}
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                "font-mono text-[10px] font-semibold",
                isMine ? "text-magenta" : "text-cyan",
              )}
            >
              {isMine ? "~$ you" : `~$ ${msg.sender?.username ?? "system"}`}
            </span>
            <span className="font-mono text-[9px] text-text-muted">
              {format(new Date(msg.createdAt), "HH:mm")}
            </span>
          </div>

          {/* Edit mode */}
          {isEditing && editingId === msg.id ? (
            <div className="flex flex-col gap-1">
              <textarea
                ref={inputRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="font-mono text-sm bg-surface text-text w-full p-1 border border-magenta"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSave(msg);
                  }
                  if (e.key === "Escape") {
                    setIsEditing(false);
                    setEditingId(null);
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  className="text-[10px] font-mono text-cyan"
                  onClick={() => handleSave(msg)}
                >
                  Save
                </button>
                <button
                  className="text-[10px] font-mono text-text-muted"
                  onClick={() => {
                    setIsEditing(false);
                    setEditingId(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* ── Attachment Rendering ────────────────────────────── */}
              {msg.type === "image" && (
                <div
                  className="relative group/img cursor-pointer overflow-hidden rounded-sm border border-border"
                  onClick={() => {
                    const url = (msg as any).metadata?.signedUrl as
                      | string
                      | undefined;
                    if (url) {
                      setLightboxImage(url);
                    }
                  }}
                >
                  <img
                    src={
                      (msg as any).metadata?.signedUrl ||
                      (msg as any).metadata?.file_url ||
                      ""
                    }
                    alt={msg.content}
                    className="max-w-full max-h-64 object-contain bg-black"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="w-5 h-5 text-white" />
                  </div>
                </div>
              )}

              {msg.type === "file" && (
                <div className="flex items-center gap-3 p-2 bg-surface border border-border rounded-sm hover:bg-surface-raised transition-colors group/file">
                  <div className="w-10 h-10 bg-surface-overlay flex items-center justify-center rounded-sm border border-border">
                    <FileText className="w-5 h-5 text-cyan" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-text truncate">
                      {msg.content}
                    </p>
                    <p className="font-mono text-[10px] text-text-muted">
                      {((msg as any).metadata?.file_size || 0) / 1024} KB
                    </p>
                  </div>
                  <a
                    href={
                      (msg as any).metadata?.signedUrl ||
                      (msg as any).metadata?.file_url ||
                      "#"
                    }
                    download
                    className="p-2 hover:bg-surface-overlay rounded-sm transition-colors"
                  >
                    <Download className="w-4 h-4 text-text-muted group-hover/file:text-cyan" />
                  </a>
                </div>
              )}

              <p
                className={cn(
                  "font-mono text-sm text-text leading-relaxed whitespace-pre-wrap break-words",
                  isDeleted && "text-text-muted",
                )}
              >
                {isDeleted ? "[deleted]" : msg.content}
              </p>
            </div>
          )}

          {/* ── Reaction display row ───────────────────────────────── */}
          {reactionGroups.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {reactionGroups.map((group) => (
                <button
                  key={group.emoji}
                  onClick={() =>
                    toggleReaction(
                      msg.id,
                      group.emoji,
                      msgReactions,
                      user?.id ?? "",
                    )
                  }
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-xs font-mono transition-colors",
                    group.hasReacted
                      ? "bg-cyan/15 border border-cyan/40 text-cyan"
                      : "bg-surface-overlay/50 border border-border text-text-dim hover:bg-surface-overlay hover:text-text",
                  )}
                >
                  <span className="text-sm leading-none">{group.emoji}</span>
                  <span className="text-[10px] leading-none">
                    {group.count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ── Floating reaction picker ──────────────────────────── */}
          {!isDeleted && (
            <div
              className={cn(
                "absolute -bottom-3 right-2 flex items-center gap-0.5",
                "bg-surface border border-border rounded-sm px-1.5 py-1 shadow-lg",
                "opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto",
                "z-10",
              )}
            >
              {QUICK_EMOJIS.map((emoji) => {
                const alreadyReacted = msgReactions.some(
                  (r) => r.userId === user?.id && r.reaction === emoji,
                );
                return (
                  <button
                    key={emoji}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleReaction(
                        msg.id,
                        emoji,
                        msgReactions,
                        user?.id ?? "",
                      );
                    }}
                    className={cn(
                      "rounded-sm px-1 py-0.5 text-base leading-none transition-colors",
                      alreadyReacted ? "bg-cyan/20" : "hover:bg-surface-overlay",
                    )}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── List component ────────────────────────────────────────────────

  return (
    <>
      <Virtuoso
        className="flex-1"
        data={messages}
        followOutput="auto"
        itemContent={renderMessage}
        components={{
          Header: () => <div className="pt-4" />,
          Footer: () => (
            <>
              {othersTyping.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-1.5">
                  <span className="font-mono text-[11px] text-cyan/70 animate-pulse">
                    ~$ {othersTyping.length > 1 ? "Several people" : "Someone"}{" "}
                    {othersTyping.length === 1 ? "is" : "are"} typing
                    <span className="inline-flex ml-0.5">
                      <span className="animate-typing-dot">.</span>
                      <span className="animate-typing-dot animation-delay-200">
                        .
                      </span>
                      <span className="animate-typing-dot animation-delay-400">
                        .
                      </span>
                    </span>
                  </span>
                </div>
              )}
              <div className="pb-4" />
            </>
          ),
        }}
      />

      {/* ── Lightbox ──────────────────────────────────────────────── */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxImage(null);
            }}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxImage}
            alt="Full size"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}
    </>
  );
}
