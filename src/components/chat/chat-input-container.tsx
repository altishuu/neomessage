"use client";

import { useParams } from "next/navigation";
import { MessageInput } from "@/components/chat/message-input";

export default function ChatInputContainer({ 
  onSend, 
  onTypingChange 
}: { 
  onSend: (content: string) => Promise<void>, 
  onTypingChange: (typing: boolean) => void 
}) {
  const params = useParams();
  const conversationId = params?.conversationId as string;

  return (
    <MessageInput 
      conversationId={conversationId}
      onSend={onSend}
      onTypingChange={onTypingChange}
    />
  );
}
