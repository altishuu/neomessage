"use client";

import { Button } from "@/components/ui/button";

interface ConversationListEmptyProps {
  onCreateNew: () => void;
}

export function ConversationListEmpty({
  onCreateNew,
}: ConversationListEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <p className="font-mono text-text-dim text-sm mb-4">
        ~$ no conversations found
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={onCreateNew}
      >
        Start a conversation
      </Button>
    </div>
  );
}
