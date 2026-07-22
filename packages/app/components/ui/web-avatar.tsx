"use client";

/**
 * WebAvatar — DOM mirror of components/ui/avatar (native): image when a real
 * URL exists, otherwise the SAME fallback mobile shows — brand-blue tile
 * (#3EA4E5, #34A2DF border), white uppercase initial, rounded square.
 * Replaces the pravatar.cc placeholder (random strangers' photos are not an
 * acceptable identity fallback).
 */

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function resolveUrl(avatar: string | null | undefined): string | null {
  if (!avatar || !avatar.trim()) return null;
  if (/^https?:\/\//i.test(avatar)) return avatar;
  return `${CDN_URL}/${avatar}`;
}

export function WebAvatar({
  avatar,
  username,
  size = 44,
  className = "",
}: {
  avatar: string | null | undefined;
  username: string | null | undefined;
  /** Pixel size (square). */
  size?: number;
  className?: string;
}) {
  const url = resolveUrl(avatar);
  const radius = Math.min(Math.round(size * 0.18), 16);
  const initial = (username?.trim()?.[0] || "U").toUpperCase();

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={username || "User"}
        width={size}
        height={size}
        loading="lazy"
        className={`shrink-0 object-cover bg-[#1a1a1a] ${className}`}
        style={{ width: size, height: size, borderRadius: radius, border: "1.5px solid #34A2DF" }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center font-bold text-white ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: "#3EA4E5",
        border: "1.5px solid #34A2DF",
        fontSize: Math.round(size / 2),
      }}
    >
      {initial}
    </span>
  );
}
