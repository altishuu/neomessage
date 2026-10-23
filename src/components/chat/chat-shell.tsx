"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/chat/sidebar";
import { getMobileChatView } from "@/lib/chat-navigation-state.mjs";
import { cn } from "@/lib/utils";

export function ChatShell({ children }: { children: ReactNode }) {
  const mobileView = getMobileChatView(usePathname());

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-surface md:h-screen">
      <Sidebar mobileView={mobileView} />
      <main
        className={cn(
          "min-w-0 flex-1 flex-col",
          mobileView === "conversation" ? "flex" : "hidden md:flex",
        )}
      >
        {children}
      </main>
    </div>
  );
}
