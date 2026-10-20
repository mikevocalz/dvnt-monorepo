"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Heart, X } from "lucide-react";
import { usePostLikers } from "@dvnt/app/lib/hooks/use-post-likers";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { resolveAvatarUrl } from "@dvnt/app/lib/media/resolveAvatarUrl";

export interface LikesSheetProps {
  postId: string | null;
  onClose: () => void;
  onProfilePress: (username: string) => void;
}

/** Shared feed/detail likes popover: mobile bottom sheet, desktop dialog. */
export function LikesSheet({ postId, onClose, onProfilePress }: LikesSheetProps) {
  const open = !!postId;
  const viewerId = useAuthStore((s) => s.user?.id);
  const {
    data: likers = [], isLoading, isError, refetch,
    hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError,
  } = usePostLikers(postId ?? undefined, open, 50);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    panel?.querySelector<HTMLButtonElement>('button[aria-label="Close likes"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex="0"]',
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1600] flex items-end justify-center bg-black/70 md:items-center md:p-6"
      data-likes-backdrop=""
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#101321] text-white shadow-2xl md:max-w-md md:rounded-3xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-bold">
            <Heart size={18} aria-hidden="true" /> Likes
          </h2>
          <button
            type="button"
            aria-label="Close likes"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          data-likes-scroll=""
          onScroll={(event) => {
            const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
            if (scrollHeight - scrollTop - clientHeight < 160 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
              void fetchNextPage({ cancelRefetch: false });
            }
          }}
        >
          {!viewerId ? (
            <p className="py-8 text-center text-sm text-white/60">Sign in to see who liked this post.</p>
          ) : isLoading ? (
            <p role="status" className="py-8 text-center text-sm text-white/60">Loading likes…</p>
          ) : isError && likers.length === 0 ? (
            <div role="alert" className="py-8 text-center text-sm">
              <p className="text-white/60">Couldn’t load likes. Please try again.</p>
              <button type="button" onClick={() => void refetch()} className="mt-3 rounded-xl bg-white/10 px-4 py-2">Try again</button>
            </div>
          ) : likers.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/60">No likes yet.</p>
          ) : (
            <ul aria-label="People who liked this post" className="flex flex-col gap-1">
              {likers.map((liker) => {
                const avatar = resolveAvatarUrl(liker.avatar);
                return (
                  <li key={liker.userId}>
                    <button
                      type="button"
                      aria-label={`View @${liker.username}'s profile`}
                      onClick={() => { onClose(); onProfilePress(liker.username); }}
                      className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                    >
                      <span aria-hidden="true" className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white/10 font-semibold">
                        {(liker.username.trim()[0] || "U").toUpperCase()}
                        {avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatar} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate text-[15px] font-semibold">@{liker.username}</span>
                        {liker.displayName ? <span className="truncate text-xs text-white/60">{liker.displayName}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {likers.length > 0 && isError ? <p role="alert" className="pt-3 text-center text-sm text-white/60">Couldn’t load more likes.</p> : null}
          {hasNextPage ? (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage({ cancelRefetch: false })}
              className="my-3 w-full rounded-xl bg-white/10 px-4 py-3 text-sm disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading more…" : isFetchNextPageError ? "Try again" : "Load more"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
