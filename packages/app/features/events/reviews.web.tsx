"use client";

/**
 * Event Reviews — WEB (@dvnt/app/features/events/reviews). URL
 * /feed/events/{id}/reviews. Port of native
 * `app/(protected)/events/[id]/reviews.tsx`: the full ratings & reviews list
 * for an event with a write-review composer.
 *
 * Law 1 (sacred data wiring): the list + ratings come from the SAME hooks
 * native uses — `useEventReviews(id, 100)` (react-query over
 * eventsApi.getEventReviews) — and submitting calls `useCreateEventReview()`
 * exactly like native (optimistic prepend / rollback / invalidate live in the
 * hook). The avg + 5-star distribution are derived from the same review list.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * <View>/<Text>. The review list is rendered with TanStack Virtual (project
 * rule — never FlatList/FlashList). Star rating is raw lucide-react Star
 * buttons (filled cyan/amber) for both the summary display and the composer.
 * Avatars are rounded squares (never circles). The write-review draft (rating
 * + comment) lives in a tiny Zustand store, not useState. The composer is a
 * kit Dialog (native uses a modal-style submit flow). Sticky "Reviews" header,
 * content max-w-2xl, bg #06070d, accent cyan #3FDCFF.
 */

import { useMemo, useRef } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Star, PenSquare } from "lucide-react";
import { useEventReviews, useCreateEventReview } from "@dvnt/app/lib/hooks/use-event-reviews";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEventReviewDraftStore } from "@dvnt/app/lib/stores/event-review-draft-store";
import { Dialog } from "@dvnt/ui";

const ACCENT = "#3FDCFF";
const AMBER = "#F5C518";

// CDN URL with production fallback (mirrors native getAvatarUrl).
const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function getAvatarUrl(avatar: string | null | undefined): string {
  if (!avatar) return "https://i.pravatar.cc/150?img=0";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

interface ReviewRow {
  id: string | number;
  rating: number;
  comment?: string;
  username?: string;
  user?: { username?: string; name?: string; avatar?: string } | null;
  createdAt?: string;
  created_at?: string;
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Read-only star row (filled amber up to `rating`). */
function StarsDisplay({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          color={AMBER}
          fill={i <= Math.round(rating) ? AMBER : "transparent"}
        />
      ))}
    </span>
  );
}

const ROW_ESTIMATE = 132;

export function EventReviewsScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = String((params as any)?.id ?? "");

  // SACRED: same hook native uses for the full list (limit 100 like native).
  const { data: reviewsRaw, isLoading } = useEventReviews(eventId, 100);
  const reviews = (reviewsRaw as ReviewRow[] | undefined) ?? [];

  const openComposer = useEventReviewDraftStore((s) => s.openComposer);

  // avg + 5-star distribution, derived from the same review list as native.
  const stats = useMemo(() => {
    if (!reviews.length) {
      return { avg: 0, count: 0, distribution: [0, 0, 0, 0, 0] };
    }
    const total = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
    const dist = [0, 0, 0, 0, 0];
    for (const r of reviews) {
      const i = Math.max(1, Math.min(5, Math.round(r.rating || 0))) - 1;
      dist[i]++;
    }
    return {
      avg: total / reviews.length,
      count: reviews.length,
      distribution: dist, // index 0 = 1-star, 4 = 5-star
    };
  }, [reviews]);

  // List = TanStack Virtual (never FlatList/FlashList).
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: reviews.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 -ml-1 rounded-xl flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={22} color="#fff" />
        </button>
        <h1 className="flex-1 text-[17px] font-bold">Reviews</h1>
        <button
          onClick={openComposer}
          aria-label="Write a review"
          className="flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-sm font-semibold text-[#3FDCFF] active:scale-95"
        >
          <PenSquare size={16} color={ACCENT} />
          Write
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 pb-32 pt-4">
        {isLoading && reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
            <p className="mt-4 text-sm text-white/60">Loading reviews...</p>
          </div>
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-10 py-24 text-center">
            <Star size={36} color="#666" strokeWidth={1.5} />
            <p className="mt-1 text-[17px] font-bold text-white">No reviews yet</p>
            <p className="text-[13px] leading-[18px] text-white/60">
              Check back after the event — attendees can rate it then.
            </p>
            <button
              onClick={openComposer}
              className="mt-4 rounded-xl bg-[#3FDCFF] px-5 py-2.5 text-sm font-bold text-black active:scale-95"
            >
              Write a review
            </button>
          </div>
        ) : (
          <>
            {/* ── Summary: avg + star breakdown ───────────────────── */}
            <section
              className="flex gap-5 rounded-2xl border border-white/10 bg-white/4 p-4"
              aria-label="Rating summary"
            >
              <div className="flex min-w-[96px] flex-col items-center justify-center gap-1.5">
                <span className="text-[34px] font-extrabold leading-none tracking-tight">
                  {stats.avg.toFixed(1)}
                </span>
                <StarsDisplay rating={stats.avg} size={18} />
                <span className="text-xs font-medium text-white/60">
                  {stats.count} review{stats.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = stats.distribution[star - 1];
                  const pct =
                    stats.count > 0
                      ? Math.round((count / stats.count) * 100)
                      : 0;
                  return (
                    <div key={star} className="flex items-center gap-2">
                      <span className="w-[18px] text-[11px] font-semibold text-white/60">
                        {star}★
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: AMBER }}
                        />
                      </div>
                      <span className="min-w-[20px] text-right text-[11px] font-medium text-white/60">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Review list (TanStack Virtual) ──────────────────── */}
            <div
              ref={parentRef}
              className="mt-4 overflow-y-auto"
              style={{ maxHeight: "calc(100dvh - 260px)" }}
            >
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const r = reviews[item.index];
                  if (!r) return null;
                  const author =
                    r.username ||
                    r.user?.username ||
                    r.user?.name ||
                    "Anonymous";
                  const when = formatRelative(r.createdAt || r.created_at);
                  return (
                    <div
                      key={String(r.id)}
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${item.start}px)`,
                        paddingBottom: 12,
                      }}
                    >
                      <article className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/4 p-3.5">
                        <div className="flex items-center gap-3">
                          {/* Avatar — rounded square (never circle). */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getAvatarUrl(r.user?.avatar)}
                            alt={author}
                            className="h-10 w-10 shrink-0 rounded-xl object-cover bg-white/10"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-white">
                              {author}
                            </p>
                            {when ? (
                              <p className="text-[11px] font-medium text-white/50">
                                {when}
                              </p>
                            ) : null}
                          </div>
                          <StarsDisplay rating={r.rating || 0} size={14} />
                        </div>
                        {r.comment ? (
                          <p className="mt-1 text-[13px] leading-[18px] text-white/90">
                            {r.comment}
                          </p>
                        ) : null}
                      </article>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      <WriteReviewComposer eventId={eventId} />
    </div>
  );
}

export default EventReviewsScreen;

/**
 * WriteReviewComposer — kit Dialog (web translation of the native submit
 * modal). The rating + comment draft live in Zustand (no useState). Submitting
 * calls the SACRED `useCreateEventReview()` mutation native uses; the rating is
 * picked with raw lucide-react Star buttons (filled cyan when selected).
 */
function WriteReviewComposer({ eventId }: { eventId: string }) {
  const open = useEventReviewDraftStore((s) => s.open);
  const rating = useEventReviewDraftStore((s) => s.rating);
  const comment = useEventReviewDraftStore((s) => s.comment);
  const setRating = useEventReviewDraftStore((s) => s.setRating);
  const setComment = useEventReviewDraftStore((s) => s.setComment);
  const reset = useEventReviewDraftStore((s) => s.reset);

  const user = useAuthStore((s) => s.user);
  const createReview = useCreateEventReview();

  const canSubmit = rating > 0 && !createReview.isPending;

  const submit = () => {
    if (!canSubmit) return;
    createReview.mutate(
      {
        eventId,
        rating,
        comment: comment.trim() || undefined,
        authorUsername: user?.username,
      },
      { onSuccess: () => reset() },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!createReview.isPending) reset();
      }}
      title="Write a review"
      footer={
        <>
          <button
            type="button"
            disabled={createReview.isPending}
            onClick={reset}
            className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="flex-1 rounded-xl bg-[#3FDCFF] py-3 font-bold text-black disabled:opacity-40"
          >
            {createReview.isPending ? "Submitting…" : "Submit"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Star picker — raw Star buttons, filled cyan when selected. */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-sm font-medium text-white/60">
            Tap to rate
          </span>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((i) => {
              const active = i <= rating;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setRating(i)}
                  aria-label={`${i} star${i === 1 ? "" : "s"}`}
                  className="p-1 active:scale-95"
                >
                  <Star
                    size={34}
                    color={active ? ACCENT : "#555"}
                    fill={active ? ACCENT : "transparent"}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Comment */}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Share your experience (optional)…"
          rows={4}
          className="w-full resize-none rounded-xl border border-white/12 bg-white/4 px-3 py-2.5 text-[15px] text-white placeholder:text-white/40 outline-none focus:border-[#3FDCFF]/50"
        />

        {createReview.isError ? (
          <p className="text-sm text-rose-400">
            Couldn&apos;t submit your review. Please try again.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
