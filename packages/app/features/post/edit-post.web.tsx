"use client";
import { usePostMediaLease } from "@dvnt/app/lib/media/use-post-media-lease";
import { retirePostMediaLeases } from "@dvnt/app/lib/media/post-media-lease-events";
import { getEditableMediaIds } from "@dvnt/app/lib/posts/edit-post-media";

/**
 * Edit Post — WEB (@dvnt/app/features/post/edit-post). Real web port of the
 * native editor `(protected)/edit-post/[id].tsx` (the sibling
 * `(protected)/post/edit/[id].tsx` just redirects here, so this one screen
 * serves both web routes).
 *
 * Both routes use the same owner-only save API as native. The published
 * media editor only removes selected items; it never uploads replacement bytes.
 *
 * Law 3 (web idioms): NativeWind interop OFF — Tailwind className on raw DOM
 * tags only, no <View>/<Text>. State lives in the dedicated Zustand
 * `useEditPostStore` (never useState). Form kit FormField + StickySaveBar +
 * useDirtyGuard. Avatars / media tiles are rounded SQUARES, no pills.
 * Navigation via solito useRouter; on save → back.
 */

import { getCaptionMetrics, validatePostCaption, MAX_CAPTION_LENGTH, MAX_CAPTION_RAW_LENGTH } from "@dvnt/app/lib/posts/post-caption";
import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "solito/navigation";
import { AlertCircle, MapPin, Flame, ImageIcon, Play } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormField, StickySaveBar, useDirtyGuard } from "@dvnt/ui";
import { usePost, postKeys } from "@dvnt/app/lib/hooks/use-posts";
import { postsApi } from "@dvnt/app/lib/api/posts";
import { postTagsApi, type PostTag } from "@dvnt/app/lib/api/post-tags";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { resolveTextPostPresentation } from "@dvnt/app/lib/posts/text-post";
import type { Post } from "@dvnt/app/lib/types";
import { useEditPostStore } from "./edit-post-store";
import { ownsContent } from "@dvnt/app/lib/profile/same-user";

const MAX_CAPTION = MAX_CAPTION_LENGTH;

const inputCls =
  "w-full bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11 text-[15px] text-white placeholder:text-white/40 outline-none focus:border-[#3FDCFF]/60";

export function EditPostScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = String((params as any)?.id ?? "");

  const queryClient = useQueryClient();
  const showToast = useUIStore((st) => st.showToast);
  const currentUser = useAuthStore((st) => st.user);
  const s = useEditPostStore();

  // ── Fetch post (same hook native uses for prefill) ──
  const { data: post, isLoading, isError, isPlaceholderData } = usePost(id);
  const leasedMedia = usePostMediaLease(post?.id, post?.media || []);

  // ── Post tags (Instagram-style) — same query native runs ──
  const { data: postTags = [] } = useQuery<PostTag[]>({
    queryKey: ["postTags", id],
    queryFn: () => postTagsApi.getTagsForPost(id),
    enabled: !!id,
  });

  const isTextPost = post?.kind === "text";

  // ── Prefill from the fetched post (mirrors native's useEffect) ──
  useEffect(() => {
    if (!post || String(post.id) !== id || isPlaceholderData) return;
    const presentation = resolveTextPostPresentation(
      post.textSlides,
      post.caption,
    );
    const nextCaption =
      post.kind === "text" ? presentation.previewText : post.caption || "";
    const slides =
      post.kind === "text"
        ? (presentation.textSlides.length > 0
            ? presentation.textSlides
            : [{ content: nextCaption }]
          ).map((slide) => slide.content ?? "")
        : [];

    s.hydrate({
      hydratedId: id,
      caption: nextCaption,
      location: post.location || "",
      isNSFW: post.isNSFW || false,
      textSlides: slides,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post, id, isPlaceholderData]);

  // ── Dirty detection (mirrors native's isDirty) ──
  const hydrated = s.hydratedId === id;
  const captionMetrics = getCaptionMetrics(s.caption);
  const captionValidation = validatePostCaption(s.caption);
  const captionOverLimit = isTextPost ? s.caption.length > MAX_CAPTION : !captionValidation.valid;
  const slidesDirty = useMemo(
    () =>
      s.textSlides.length !== s.originalTextSlides.length ||
      s.textSlides.some((c, i) => c !== s.originalTextSlides[i]),
    [s.textSlides, s.originalTextSlides],
  );
  const isDirty =
    hydrated &&
    !captionOverLimit &&
    (s.caption !== s.originalCaption ||
      s.location !== s.originalLocation ||
      s.isNSFW !== s.originalIsNSFW ||
      slidesDirty || s.removal !== null);
  useDirtyGuard(isDirty);

  // ── Author-only guard (mirrors native isOwner + event-edit ownership) ──
  // By id, not username: a handle comparison failed for anyone who had renamed
  // themselves, locking them out of editing their own post.
  //
  // The `return true` on missing data is kept deliberately — this guard runs
  // while the post is still loading, and defaulting to "not the owner" would
  // flash an access-denied state at the author on every open. The server
  // enforces the real rule on update.
  const isOwner = useMemo(() => {
    if (!post?.author || !currentUser) return true;
    return ownsContent(currentUser, post);
  }, [post, currentUser]);

  const updateMutation = useMutation({
    mutationFn: (updates: Parameters<typeof postsApi.updatePost>[1]) => postsApi.updatePost(id, updates),
    onError: (error) => {
      showToast("error", "Couldn't save changes", error instanceof Error && error.message
        ? error.message
        : "Couldn't save changes. Try again.");
    },
    onSuccess: async (_post, updates) => {
      if (updates.removeMedia) retirePostMediaLeases();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: postKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["profilePosts"] }),
        queryClient.invalidateQueries({ queryKey: ["postTags", id] }),
      ]);
    },
  });

  // ── Save (mirrors native handleSave) ──
  const handleSave = () => {
    if (!id || !isDirty || captionOverLimit || updateMutation.isPending) return;

    const trimmedSlides = s.textSlides.map((c) => c.trim());
    if (isTextPost && trimmedSlides.some((c) => c.length === 0)) {
      showToast("error", "Empty Slide", "Each slide needs text before saving.");
      return;
    }

    updateMutation.mutate(
      {
        ...(!isTextPost && s.caption !== s.originalCaption ? { content: s.caption.trim() } : {}),
        ...(s.location !== s.originalLocation ? { location: s.location.trim() } : {}),
        ...(s.isNSFW !== s.originalIsNSFW ? { isNSFW: s.isNSFW } : {}),
        ...(isTextPost && slidesDirty ? { slides: trimmedSlides } : {}),
        ...(s.removal ? { removeMedia: {
          ...s.removal,
          ...(s.caption !== s.originalCaption ? { expectedCaption: s.originalCaption } : {}),
        } } : {}),
      },
      {
        onSuccess: () => {
          s.reset();
          router.back();
        },
      },
    );
  };

  const handleCancel = () => {
    if (updateMutation.isPending) return;
    s.reset();
    router.back();
  };

  // ── Loading ──
  if (isLoading || isPlaceholderData || (post && !hydrated)) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white flex items-center justify-center">
        <span className="text-sm text-white/50">Loading post…</span>
      </div>
    );
  }

  // ── Error / not found ──
  if (isError || !post) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white flex flex-col items-center justify-center gap-3 px-6">
        <AlertCircle size={32} className="text-red-400" />
        <span className="text-sm text-white/60 text-center">
          This post may have been deleted or is unavailable.
        </span>
        <button
          onClick={() => router.back()}
          className="px-4 h-10 rounded-xl bg-white/8 text-sm font-semibold"
        >
          Go back
        </button>
      </div>
    );
  }

  // ── Author-only guard ──
  if (!isOwner) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white flex flex-col items-center justify-center gap-3 px-6">
        <AlertCircle size={32} className="text-red-400" />
        <span className="text-sm text-white/60 text-center">
          You can only edit your own posts.
        </span>
        <button
          onClick={() => router.back()}
          className="px-4 h-10 rounded-xl bg-white/8 text-sm font-semibold"
        >
          Go back
        </button>
      </div>
    );
  }

  const mediaItems = leasedMedia;
  const editableMediaIds = getEditableMediaIds(post.media);
  const pendingIds = s.removal?.ids ?? [];
  const hasMedia = mediaItems.length > 0;
  const activeSlide = s.textSlides[s.activeSlideIndex] ?? s.textSlides[0] ?? "";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={handleCancel}
          disabled={updateMutation.isPending}
          className="text-[16px] text-white/80 active:opacity-60"
        >
          Cancel
        </button>
        <h1 className="text-[17px] font-semibold">Edit Post</h1>
        <button
          onClick={handleSave}
          disabled={!isDirty || captionOverLimit || updateMutation.isPending}
          className="text-[16px] font-semibold text-[#3FDCFF] disabled:text-white/40"
        >
          {updateMutation.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <div inert={updateMutation.isPending} className="mx-auto w-full max-w-2xl px-4 pb-32 pt-4 flex flex-col gap-4">
        {/* Tile remains visible until Save so a selection can be undone. */}
        {hasMedia ? (
          <section className="flex flex-col gap-2">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {mediaItems.map((media, index) => {
                const mediaId = post.media.find((item) => item.order === media.order)?.mediaId;
                const pendingRemoval = !!mediaId && pendingIds.includes(mediaId);
                return (
                <div
                  key={mediaId ?? `media-${index}`}
                  className="relative shrink-0 w-40 aspect-[4/5] overflow-hidden rounded-2xl bg-black"
                >
                  <div className={pendingRemoval ? "size-full opacity-35" : "size-full"}>
                  {media.type === "video" ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={media.thumbnail || media.url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20">
                          <Play size={24} color="#fff" fill="#fff" />
                        </span>
                      </span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={media.url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                  </div>
                  {mediaId && editableMediaIds.length > 1 ? (
                    <button type="button"
                      disabled={updateMutation.isPending || (!pendingRemoval && pendingIds.length >= editableMediaIds.length - 1)}
                      aria-label={(pendingRemoval ? "Restore" : "Remove") + " media item " + (index + 1)}
                      onClick={() => s.toggleRemoval(editableMediaIds, mediaId)}
                      className="absolute right-2 top-2 rounded-lg bg-black/80 px-2 py-2 text-xs font-semibold text-white disabled:opacity-40">
                      {pendingRemoval ? "Restore" : "Remove"}
                    </button>
                  ) : null}
                </div>
              );})}
            </div>
            <div className="flex items-center gap-2 text-white/40">
              <ImageIcon size={14} />
              <span className="text-xs">
                {mediaItems.length}{" "}
                {mediaItems.length === 1 ? "item" : "items"}
                {pendingIds.length ? " · " + pendingIds.length + " marked for removal on Save" : ""}
              </span>
            </div>
          </section>
        ) : null}

        {/* Text-post slides editor (text posts only) */}
        {isTextPost && s.textSlides.length > 0 ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/55 mb-3">
              Slides
            </h2>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[15px] font-bold text-white">
                Slide {s.activeSlideIndex + 1} of {s.textSlides.length}
              </span>
            </div>
            <div className="mb-3 flex gap-2.5 overflow-x-auto pb-1">
              {s.textSlides.map((content, index) => {
                const isActive = index === s.activeSlideIndex;
                return (
                  <button
                    key={`slide-${index}`}
                    onClick={() => s.setActiveSlideIndex(index)}
                    className={`w-[76px] shrink-0 rounded-2xl border px-2.5 py-2.5 text-left ${
                      isActive
                        ? "border-[#3FDCFF]/40 bg-[#3FDCFF]/18"
                        : "border-white/8 bg-white/4"
                    }`}
                  >
                    <span
                      className={`block text-xs font-bold ${isActive ? "text-white" : "text-white/85"}`}
                    >
                      Slide {index + 1}
                    </span>
                    <span className="mt-2 block text-[11px] leading-[15px] text-white/55 line-clamp-2">
                      {content.trim() || "Empty"}
                    </span>
                  </button>
                );
              })}
            </div>
            <textarea
              value={activeSlide}
              onChange={(e) => s.updateSlide(s.activeSlideIndex, e.target.value)}
              placeholder="Speak your mind…"
              rows={6}
              className={`${inputCls} h-auto py-2.5 resize-none text-[18px] leading-7`}
            />
          </section>
        ) : null}

        {/* Caption (media posts) */}
        {!isTextPost ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <FormField label="Caption">
              <textarea
                value={s.caption}
                onChange={(e) => s.setCaption(e.target.value)}
                placeholder="Write a caption… Add #hashtags here"
                maxLength={MAX_CAPTION_RAW_LENGTH}
                rows={5}
                className={`${inputCls} h-auto py-2.5 resize-none`}
              />
            </FormField>
            <div className="mt-1.5 flex items-center justify-between">
              <span
                className={`text-xs ${captionOverLimit ? "text-red-400 font-semibold" : "text-white/40"}`}
              >
                {captionMetrics.characterCount.toLocaleString()}/
                {MAX_CAPTION.toLocaleString()}
              </span>
              {captionMetrics.hashtags.length > 0 ? (
                <span className="text-xs text-[#3FDCFF]/60">
                  {captionMetrics.hashtags.length} hashtags
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs text-white/40">Hashtags don’t count toward your caption limit.</p>
            {captionOverLimit ? (
              <p className="mt-1 text-xs font-semibold text-red-400">
                {captionValidation.error}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Location */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <FormField label="Location">
            <div className="flex items-center gap-2 bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11">
              <MapPin size={18} className="text-white/40 shrink-0" />
              <input
                className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
                placeholder="Add a location…"
                maxLength={100}
                value={s.location}
                onChange={(e) => s.setLocation(e.target.value)}
              />
            </div>
          </FormField>
        </section>

        {/* Existing post tags (read-only chips) */}
        {postTags.length > 0 ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/55 mb-3">
              Tagged People
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {postTags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-lg border border-[#8A40CF]/25 bg-[#8A40CF]/12 px-2.5 py-1.5 text-[13px] font-semibold text-[#8A40CF]"
                >
                  @{tag.username}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {/* Spicy / NSFW toggle (media posts only, mirrors native) */}
        {!isTextPost ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/55 mb-3">
              Content Rating
            </h2>
            <label className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{
                    backgroundColor: s.isNSFW
                      ? "rgba(239, 68, 68, 0.15)"
                      : "rgba(255,255,255,0.05)",
                  }}
                >
                  <Flame
                    size={18}
                    color={s.isNSFW ? "#ef4444" : "rgba(255,255,255,0.4)"}
                  />
                </span>
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold text-white">
                    Spicy Content
                  </span>
                  <span className="text-xs text-white/50 mt-0.5">
                    Mark as 18+ / sensitive content
                  </span>
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={s.isNSFW}
                onClick={() => s.setIsNSFW(!s.isNSFW)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  s.isNSFW ? "bg-red-500" : "bg-white/20"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                    s.isNSFW ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
          </section>
        ) : null}

        {/* Info banner (mirrors native) */}
        <div className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <AlertCircle size={18} className="shrink-0 text-white/25" />
          <p className="text-xs leading-[18px] text-white/55">
            Changes are saved together. You can remove media here, but you can’t replace the original files.
          </p>
        </div>
      </div>

      <StickySaveBar
        visible={isDirty}
        onSave={handleSave}
        onCancel={handleCancel}
        saving={updateMutation.isPending}
        disabled={captionOverLimit}
      />
    </div>
  );
}

export default EditPostScreen;
