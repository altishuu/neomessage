"use client";

import { cn } from "@/lib/utils";

interface AvatarProps {
  username: string;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const avatarColors = [
  "bg-cyan/20 text-cyan",
  "bg-magenta/20 text-magenta",
  "bg-green/20 text-green",
  "bg-amber/20 text-amber",
  "bg-red/20 text-red",
];

function getColorClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function Avatar({
  username,
  avatarUrl,
  avatarUpdatedAt,
  size = "md",
  className,
}: AvatarProps) {
  // Build cache-busted URL when avatar_updated_at is available
  const src =
    avatarUrl && avatarUpdatedAt
      ? `${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}t=${new Date(avatarUpdatedAt).getTime()}`
      : avatarUrl;

  if (src) {
    return (
      <img
        src={src}
        alt={username}
        className={cn(
          "rounded-sm object-cover flex-shrink-0",
          sizeMap[size],
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-sm flex items-center justify-center font-mono font-bold flex-shrink-0",
        sizeMap[size],
        getColorClass(username),
        className
      )}
    >
      {getInitials(username)}
    </div>
  );
}
