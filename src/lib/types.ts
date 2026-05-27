export interface User {
  id: string;
  email: string | null;
  username: string;
  displayName?: string;
  avatarUrl: string | null;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  isGroup: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  participants: Participant[];
  messages?: Message[];
  lastMessage?: Message | null;
}

export interface Participant {
  id: string;
  username: string;
  email: string | null;
  displayName?: string;
  avatarUrl: string | null;
}

export interface Message {
  id: string;
  content: string;
  senderId: string | null;
  sender: { id: string; username: string; avatarUrl: string | null } | null;
  type?: string;
  conversationId: string;
  readAt?: string | null;
  createdAt: string;
}
