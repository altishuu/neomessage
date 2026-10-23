import test from "node:test";
import assert from "node:assert/strict";
import { getMobileChatView } from "../src/lib/chat-navigation-state.mjs";

test("mobile chat view shows the inbox at /chat", () => {
  assert.equal(getMobileChatView("/chat"), "inbox");
});

test("mobile chat view opens the conversation for a conversation route", () => {
  assert.equal(getMobileChatView("/chat/abc-123"), "conversation");
});

test("mobile chat view does not mistake nested API routes for conversations", () => {
  assert.equal(getMobileChatView("/api/chat/abc-123"), "inbox");
});
