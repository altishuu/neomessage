export interface User {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  participants: User[];
  messages?: Message[];
  lastMessage?: Message | null;
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  sender: { id: string; username: string; avatarUrl: string | null };
  conversationId: string;
  readAt: string | null;
  createdAt: string;
}
