/** @param {string | null | undefined} pathname */
export function getMobileChatView(pathname) {
  return /^\/chat\/[^/]+(?:\/.*)?$/.test(pathname ?? "")
    ? "conversation"
    : "inbox";
}
