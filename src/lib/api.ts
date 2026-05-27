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
