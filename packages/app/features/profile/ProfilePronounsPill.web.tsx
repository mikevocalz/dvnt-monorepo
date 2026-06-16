"use client";

/**
 * ProfilePronounsPill — WEB variant (port of
 * `components/profile/ProfilePronounsPill.tsx`).
 *
 * The ONE pill shape allowed in DVNT (avatars + everything else are rounded
 * squares). Faithful to native: subtle translucent chip with the pronouns text.
 * Raw semantic <span> + Tailwind only (NativeWind interop is off on web).
 */
interface ProfilePronounsPillProps {
  pronouns?: string | null;
  inline?: boolean;
}

export function ProfilePronounsPill({
  pronouns,
  inline = false,
}: ProfilePronounsPillProps) {
  const value = typeof pronouns === "string" ? pronouns.trim() : "";
  if (!value) return null;

  return (
    <span
      className={`inline-flex items-center rounded-[10px] border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold tracking-wide ${
        inline ? "" : "self-start mt-2"
      }`}
      style={{ color: "rgba(245,245,244,0.84)" }}
    >
      {value}
    </span>
  );
}

export default ProfilePronounsPill;
