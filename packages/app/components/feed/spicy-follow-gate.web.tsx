"use client";
import { ProtectedPhotoPreview } from "./protected-photo-preview.web";
import { Link } from "solito/link";
import { FollowStatusRefresh } from "./follow-status-refresh";
import { useSpicyFollowGate } from "./use-spicy-follow-gate";
export function SpicyFollowGate({
  author,
  postId,
  height = 240,
  presentation = "card",
}: {
  author?: { id?: string; username?: string; avatar?: string };
  postId?: string;
  presentation?: "card" | "feed";
  height?: number;
}) {
  const gate = useSpicyFollowGate(author);
  if (presentation === "feed") {
    const label = gate.label === "Request to FOLLOW" ? "Follow" : gate.label;
    return (
      <section
        aria-label="Protected Spicy post"
        className="relative isolate overflow-hidden rounded-2xl bg-[#171025] text-white"
        style={{ minHeight: height }}
        data-protected-feed-blur
      >
        {/* No original URL or pixels: blur fills the media area without leaking content. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-8 blur-2xl"
          style={{ background: "radial-gradient(ellipse at 25% 30%, #72537f, transparent 65%), radial-gradient(ellipse at 75% 80%, #367083, transparent 60%), #251b32" }}
        />
        <ProtectedPhotoPreview postId={postId} />
        <div className="relative flex items-center gap-2 bg-black/30 p-3">
          <Link href={author?.username ? `/feed/${encodeURIComponent(author.username)}` : "/"} aria-label={author?.username ? `View @${author.username}` : "View member"}>
            {author?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={author.avatar} alt="" className="h-9 w-9 rounded-md object-cover" />
            ) : (
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-md bg-white/15">{author?.username?.slice(0, 1).toUpperCase() || "?"}</span>
            )}
          </Link>
          <span className="min-w-0 flex-1 truncate text-xs">{author?.username ? `@${author.username}` : "Member"}</span>
          <button type="button" disabled={gate.disabled} onClick={gate.act} aria-label={gate.label} className="min-h-11 rounded-lg bg-black/30 px-3 text-xs font-semibold disabled:opacity-40">{label}</button>
        </div>
        <p className="sr-only" aria-live="polite">{gate.note}</p>
        <div className="relative px-3">
          <FollowStatusRefresh targetId={author?.id} showError={false} recoverLockedPost />
          {gate.failed && <p role="alert" className="text-xs">Could not update follow. Please try again.</p>}
        </div>
      </section>
    );
  }
  return (
    <section
      aria-label="Protected Spicy post"
      className="relative isolate flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl bg-[#171025] p-4 text-center text-white"
      style={{ minHeight: height }}
    >
      {/* Decorative blur only. Original media and text are never mounted or fetched. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-50 blur-2xl"
        style={{
          background:
            "radial-gradient(ellipse at 25% 30%, #58336d, transparent 65%), radial-gradient(ellipse at 75% 80%, #26566b, transparent 60%)",
        }}
      />
      <strong>Request to FOLLOW</strong>
      <p className="text-xs text-white/70">{gate.note}</p>
      <button
        type="button"
        disabled={gate.disabled}
        onClick={gate.act}
        className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold disabled:opacity-40"
      >
        {gate.label}
      </button>
      <FollowStatusRefresh
        targetId={author?.id}
        showError={false}
        recoverLockedPost
      />
      {gate.failed && (
        <p role="alert" className="text-xs">
          Could not update follow. Please try again.
        </p>
      )}
    </section>
  );
}
