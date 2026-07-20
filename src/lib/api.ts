import type { User, Conversation, Message } from "@/lib/types";

const BASE = "";

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }

  return body as T;
}

// ── Conversations ───────────────────────────────────

export async function getConversations(): Promise<{
  conversations: Conversation[];
}> {
  return request("/api/conversations");
}

export async function getConversation(
  id: string
): Promise<{ conversation: Conversation }> {
  return request(`/api/conversations/${id}`);
}

export async function createConversation(
  participantOrIds: string | string[]
): Promise<{ conversation: Conversation }> {
  const body = Array.isArray(participantOrIds)
    ? { participantIds: participantOrIds }
    : { participantId: participantOrIds };

  return request("/api/conversations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function searchUsers(
  query: string
): Promise<{ users: User[] }> {
  return request(`/api/users/search?q=${encodeURIComponent(query)}`);
}

// ── Profile ─────────────────────────────────────────

export async function getProfile(): Promise<{ user: User }> {
  return request("/api/profile");
}

export async function getPublicProfile(
  id: string
): Promise<{ user: Pick<User, "username" | "avatarUrl" | "createdAt"> }> {
  return request(`/api/profile/${encodeURIComponent(id)}`);
}

export async function updateProfile(data: {
  displayName?: string;
  avatarUrl?: string;
}): Promise<{ user: User }> {
  return request("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function uploadAvatar(file: File): Promise<{
  user: User;
  avatarUrl: string;
}> {
  const formData = new FormData();
  formData.append("avatar", file);

  const res = await fetch("/api/profile/avatar", {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(body.error || `Upload failed (${res.status})`);
  }

  return body;
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "DELETE" });
}

// ── Messages ────────────────────────────────────────

export async function sendMessage(
  conversationId: string,
  content: string
): Promise<{ message: Message }> {
  return request("/api/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId, content }),
  });
}

export async function editMessage(
  messageId: string,
  content: string
): Promise<{ message: Message }> {
  return request(`/api/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export async function deleteMessage(
  messageId: string
): Promise<{ success: boolean }> {
  return request(`/api/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
  });
}

// ── Conversation Deletion ─────────────────────────

export async function deleteConversation(
  conversationId: string
): Promise<void> {
  await request(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  });
}

// ── Read Receipts ──────────────────────────────────

export async function markConversationRead(
  conversationId: string
): Promise<{ lastReadAt: string }> {
  return request("/api/messages/read", {
    method: "PATCH",
    body: JSON.stringify({ conversationId }),
  });
}

export async function getUnreadCounts(): Promise<
  Array<{ conversation_id: string; unread_count: number }>
> {
  return request("/api/messages/unread");
}

// ── Message Search ─────────────────────────────────

export async function searchMessages(
  conversationId: string,
  q: string
): Promise<{ messages: Array<{
  id: string;
  conversationId: string;
  senderId: string | null;
  content: string;
  createdAt: string;
  rank: number;
  sender: { id: string; username: string; avatarUrl: string | null } | null;
}> }> {
  return request(
    `/api/messages/search?conversationId=${encodeURIComponent(conversationId)}&q=${encodeURIComponent(q)}`
  );
}

// ── Group Participants ──────────────────────────────

export async function addParticipants(
  conversationId: string,
  userIds: string[]
): Promise<{ participants: { id: string; username: string; displayName: string | null; avatarUrl: string | null; avatarUpdatedAt: string | null }[] }> {
  return request(
    `/api/conversations/${encodeURIComponent(conversationId)}/participants`,
    {
      method: "POST",
      body: JSON.stringify({ userIds }),
    }
  );
}

export async function removeParticipant(
  conversationId: string,
  userId?: string
): Promise<void> {
  const body = userId ? { userId } : {};
  await request(
    `/api/conversations/${encodeURIComponent(conversationId)}/participants`,
    {
      method: "DELETE",
      body: JSON.stringify(body),
    }
  );
}

// ── Pin ─────────────────────────────────────────────

export async function togglePin(
  conversationId: string,
  isPinned: boolean
): Promise<{ isPinned: boolean }> {
  return request(
    `/api/conversations/${encodeURIComponent(conversationId)}/pin`,
    {
      method: "PATCH",
      body: JSON.stringify({ isPinned }),
    }
  );
}
