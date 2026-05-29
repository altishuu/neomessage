"use client";

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { Paperclip, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MessageInputProps {
  onSend: (content: string) => Promise<void>;
  onTypingChange?: (typing: boolean) => void;
  conversationId: string;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageInput({
  onSend,
  onTypingChange,
  conversationId,
  disabled = false,
  placeholder = "Type a message...",
}: MessageInputProps) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [attachment, setAttachment] = useState<{ file: File; preview: string | null } | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevEmptyRef = useRef(true);

  // ── Typing detection ──────────────────────────────────────────────
  useEffect(() => {
    const isEmpty = content.trim().length === 0;
    if (isEmpty !== prevEmptyRef.current) {
      prevEmptyRef.current = isEmpty;
      onTypingChange?.(!isEmpty);
    }
  }, [content, onTypingChange]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let preview = null;
    if (file.type.startsWith("image/")) {
      preview = URL.createObjectURL(file);
    }
    setAttachment({ file, preview });
  };

  const removeAttachment = () => {
    if (attachment?.preview) {
      URL.revokeObjectURL(attachment.preview);
    }
    setAttachment(null);
  };

  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if ((!trimmed && !attachment) || sending || disabled) return;

    setSending(true);
    try {
      if (attachment) {
        // 1. Upload file first
        setUploading(true);
        const formData = new FormData();
        formData.append("file", attachment.file);
        formData.append("conversationId", conversationId);

        // We use XMLHttpRequest to track progress as fetch doesn't support upload progress natively
        const uploadPromise = new Promise<{ message: any; signedUrl: string }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/messages/upload");
          
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setUploadProgress(Math.round((event.loaded / event.total) * 100));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(JSON.parse(xhr.responseText));
            } else {
              reject(new Error(xhr.responseText || "Upload failed"));
            }
          };
          xhr.onerror = () => reject(new Error("Network error during upload"));
          xhr.send(formData);
        });

        const { message, signedUrl } = await uploadPromise;
        
        // If there was text content, we can't easily "merge" them into one DB row 
        // without a new API. For now, we treat the upload as a separate message 
        // and then send the text message if it exists.
        // The /api/messages/upload already creates a message row.
        
        removeAttachment();
      }

      if (trimmed) {
        await onSend(trimmed);
      }

      setContent("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (err) {
      console.error("Send error:", err);
      // Error handled by parent usually, but if it's an upload error, we might need local state
    } finally {
      setSending(false);
      setUploading(false);
      setUploadProgress(0);
    }
  }, [content, sending, disabled, onSend, attachment, conversationId]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-t border-border bg-surface">
      {/* Attachment Preview */}
      {attachment && (
        <div className="flex items-center gap-2 p-2 bg-surface-raised border border-border rounded-sm relative w-fit max-w-xs">
          {attachment.preview ? (
            <img 
              src={attachment.preview} 
              alt="Preview" 
              className="w-12 h-12 object-cover rounded-sm border border-border" 
            />
          ) : (
            <div className="w-12 h-12 bg-surface-overlay flex items-center justify-center rounded-sm border border-border">
              <Paperclip className="w-4 h-4 text-text-muted" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-text truncate">
              {attachment.file.name}
            </p>
            <p className="text-[10px] font-mono text-text-muted">
              {(attachment.file.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button 
            onClick={removeAttachment}
            className="p-1 hover:bg-surface-overlay rounded-sm transition-colors"
          >
            <X className="w-3 h-3 text-text-muted hover:text-red" />
          </button>
          
          {uploading && (
            <div className="absolute inset-0 bg-surface/80 flex flex-col items-center justify-center rounded-sm gap-1">
              <Loader2 className="w-4 h-4 animate-spin text-cyan" />
              <span className="text-[10px] font-mono text-cyan">{uploadProgress}%</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={placeholder}
            rows={1}
            disabled={disabled || sending}
            className={cn(
              "w-full bg-surface-raised border border-border rounded-sm px-3 py-2.5 pr-10",
              "font-mono text-sm text-text placeholder:text-text-muted resize-none",
              "focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/30",
              "transition-colors duration-150",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "min-h-[38px] max-h-[160px]"
            )}
          />
        </div>
        
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
            accept="image/*,application/pdf,text/plain,application/zip"
          />
          <Button
            variant="ghost"
            size="md"
            className="flex-shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || sending || uploading}
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSend}
            disabled={(!content.trim() && !attachment) || sending || disabled}
            className="flex-shrink-0"
          >
            {sending ? "..." : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
