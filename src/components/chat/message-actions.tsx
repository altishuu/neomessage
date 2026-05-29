"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface MessageActionsProps {
  onEdit: () => void;
  onDelete: () => void;
}

export function MessageActions({ onEdit, onDelete }: MessageActionsProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="font-mono text-xs">...</span>
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-10 w-24 bg-surface-raised border border-border rounded-sm shadow-lg overflow-hidden">
          <button
            className="w-full text-left px-3 py-2 font-mono text-xs text-text hover:bg-surface-overlay"
            onClick={() => {
              onEdit();
              setIsOpen(false);
            }}
          >
            Edit
          </button>
          <button
            className="w-full text-left px-3 py-2 font-mono text-xs text-red hover:bg-red/10"
            onClick={() => {
              onDelete();
              setIsOpen(false);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
