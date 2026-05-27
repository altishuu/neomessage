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

// ── Auth ────────────────────────────────────────────

export async function login(
  email: string,
  password: string
): Promise<{ user: User }> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(
  email: string,
  username: string,
  password: string
): Promise<{ user: User }> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
}

export async function getCurrentUser(): Promise<{ user: User }> {
  return request("/api/auth/me");
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
  participantId: string
): Promise<{ conversation: Conversation }> {
  return request("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ participantId }),
  });
}

export async function searchUsers(
  query: string
): Promise<{ users: User[] }> {
  return request(`/api/users/search?q=${encodeURIComponent(query)}`);
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
