"use client";

/** Rounded SQUARE avatar — the repo's rule, never circles. */

export function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string | null | undefined;
  src: string | null | undefined;
  size?: "sm" | "md" | "lg";
}) {
  const dims =
    size === "lg" ? "h-14 w-14" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  if (src) {
    return (
      <img src={src} alt="" className={`${dims} rounded-lg object-cover`} />
    );
  }
  return (
    <span
      aria-hidden
      className={`grid ${dims} place-items-center rounded-lg bg-[#8A40CF]/25 font-semibold text-[#C9A2F0]`}
    >
      {(name ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}
