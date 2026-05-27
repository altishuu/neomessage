import { Sidebar } from "@/components/chat/sidebar";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
