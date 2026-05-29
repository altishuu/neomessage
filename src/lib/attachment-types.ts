import type { Message } from "@/lib/types";

export interface MessageAttachment {
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface MessageWithAttachments extends Message {
  attachment?: MessageAttachment;
}
