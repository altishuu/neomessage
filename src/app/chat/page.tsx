export default function ChatEmptyPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-surface">
      <div className="text-center px-4">
        <div className="mb-4">
          <p className="font-mono text-xs text-text-muted">
            ┌─────────────────────────────┐
          </p>
          <p className="font-mono text-sm text-text-dim my-2">
            ~$ select a conversation
          </p>
          <p className="font-mono text-xs text-text-muted">
            └─────────────────────────────┘
          </p>
        </div>
        <p className="font-mono text-xs text-text-muted mt-4">
          Choose a conversation from the sidebar
        </p>
        <p className="font-mono text-xs text-text-muted mt-1">
          or start a new one to begin messaging
        </p>
      </div>
    </div>
  );
}
