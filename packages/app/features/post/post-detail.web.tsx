/**
 * Post detail — WEB (@dvnt/app/features/post/post-detail). Instagram-style URL
 * /feed/{username}/post/{id}; id read from Solito route params. The native post
 * screen can't run on web (native modules), so this is a focused web view over
 * the SHARED data (usePost / useComments / useCreateComment → react-query).
 * Raw semantic tags + Tailwind; threaded comments + composer (draft in Zustand).
 */
import { useEffect } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Heart,
  MessageCircle,
  Bookmark,
  Send,
  Play,
  MoreHorizontal,
  Pencil,
  Trash2,
  Flag,
  Languages,
} from "lucide-react";
import { usePost, useDeletePost } from "@dvnt/app/lib/hooks/use-posts";
import { useComments, useCreateComment } from "@dvnt/app/lib/hooks/use-comments";
import { usePostLikeState } from "@dvnt/app/lib/hooks/usePostLikeState";
import {
  useToggleBookmark,
  useBookmarks,
} from "@dvnt/app/lib/hooks/use-bookmarks";
import { usePostTags } from "@dvnt/app/lib/hooks/use-post-tags";
import { usePostLikers } from "@dvnt/app/lib/hooks/use-post-likers";
import { useBookmarkStore } from "@dvnt/app/lib/stores/bookmark-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCommentDraftStore } from "@dvnt/app/lib/stores/comment-draft-store";
import { useCarouselStore } from "@dvnt/app/lib/stores/carousel-store";
import { usePostTagsUIStore } from "@dvnt/app/lib/stores/post-tags-store";
import { useContentTranslation } from "@dvnt/app/lib/stores/translation-store";
import { shouldShowTranslateButton } from "@dvnt/app/lib/utils/language-detection";
import { useReportSheetStore } from "@dvnt/app/lib/stores/report-sheet-store";
import {
  usePostDetailUIStore,
  useLikesSheet,
} from "@dvnt/app/lib/stores/post-detail-ui-store";
import { ThreadedComment } from "@dvnt/app/components/comments/threaded-comment";
import { useLightboxStore } from "@dvnt/app/lib/stores/lightbox-store";
import { Lightbox } from "@dvnt/app/components/lightbox.web";
import { Dialog, Drawer } from "@dvnt/ui";
import { postsApi } from "@dvnt/app/lib/api/posts";
import { resolveTextPostPresentation } from "@dvnt/app/lib/posts/text-post";
import { TextPostSurface } from "@dvnt/app/components/post/TextPostSurface";

const VIDEO_URL_RE = /post-video|\.mp4(\?|$)|\.mov(\?|$)|\.m3u8(\?|$)|\.webm(\?|$)/i;

export function PostDetailScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = String((params as any)?.id ?? "");
  const { data: post, isLoading } = usePost(id);
  const { data: comments } = useComments(id);
  const setReplyTo = useCommentDraftStore((s) => s.setReplyTo);
  const openComposer = useCommentDraftStore((s) => s.openComposer);
  const currentUser = useAuthStore((s) => s.user);
  // Functional like + bookmark (writes authenticate via the same-origin proxy).
  const {
    likes,
    hasLiked,
    toggle: toggleLike,
  } = usePostLikeState(id, post?.likes || 0, post?.viewerHasLiked || false);
  // Server is the source of truth for is-bookmarked (same hook native uses);
  // the Zustand store mirrors it for instant optimistic flips.
  const { data: bookmarkedPostIds = [] } = useBookmarks();
  const bookmarkedPosts = useBookmarkStore((s) => s.bookmarkedPosts);
  const isBookmarked =
    bookmarkedPostIds.includes(id) || bookmarkedPosts.includes(id);
  const toggleBookmark = useToggleBookmark();
  const deletePost = useDeletePost();

  // ⋯ overflow menu + delete-confirm dialog (Zustand, not useState).
  const showMenu = usePostDetailUIStore((s) => s.showMenu);
  const setShowMenu = usePostDetailUIStore((s) => s.setShowMenu);
  const showDeleteConfirm = usePostDetailUIStore((s) => s.showDeleteConfirm);
  const setShowDeleteConfirm = usePostDetailUIStore(
    (s) => s.setShowDeleteConfirm,
  );
  const isDeleting = usePostDetailUIStore((s) => s.isDeleting);
  const setIsDeleting = usePostDetailUIStore((s) => s.setIsDeleting);
  const resetPostDetailUI = usePostDetailUIStore((s) => s.reset);
  const openReportSheet = useReportSheetStore((s) => s.openReportSheet);

  // Tagged-people (Instagram-style tap-to-reveal), same hook/store as native.
  const { data: postTags = [] } = usePostTags(id);
  const tagsVisible = usePostTagsUIStore((s) => s.visibleTags[id] ?? false);
  const toggleTags = usePostTagsUIStore((s) => s.toggleTags);

  // Who-liked sheet (web mirror of native LikesSheetController).
  const {
    open: openLikesSheet,
    prefetch: prefetchLikesSheet,
    activePostId: likesSheetPostId,
  } = useLikesSheet();

  // Caption translation toggle — same hook + store as native.
  const captionText = post?.caption ?? "";
  const {
    displayText: translatedCaption,
    isTranslated: isCaptionTranslated,
    translate: translateCaption,
    showOriginal: showOriginalCaption,
  } = useContentTranslation(`post-detail-${id}-caption`, captionText, "en");

  // Text-post slides: native hydrates the full slide set via this query key
  // when the post is a text post (the list payload only carries a preview).
  const isTextPost =
    post?.kind === "text" || (post?.textSlides?.length ?? 0) > 0;
  const { data: hydratedTextPost } = useQuery({
    queryKey: ["postDetailTextSlides", id],
    queryFn: () => postsApi.getPostById(id),
    enabled: !!id && isTextPost,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
  });

  // Reset the carousel to the first slide when opening a different post.
  const setCarouselIndex = useCarouselStore((s) => s.setIndex);
  useEffect(() => {
    setCarouselIndex(0);
  }, [id, setCarouselIndex]);

  // Clear transient menu/dialog/sheet flags when leaving the screen.
  useEffect(() => () => resetPostDetailUI(), [id, resetPostDetailUI]);

  const isOwner =
    !!currentUser?.username &&
    !!post?.author?.username &&
    currentUser.username.toLowerCase() === post.author.username.toLowerCase();

  const handleDelete = () => {
    if (!id || isDeleting) return;
    setIsDeleting(true);
    deletePost.mutate(id, {
      onSuccess: () => {
        setIsDeleting(false);
        setShowDeleteConfirm(false);
        setShowMenu(false);
        router.back();
      },
      onError: () => {
        setIsDeleting(false);
      },
    });
  };

  const handleTranslateCaption = () => {
    if (isCaptionTranslated) {
      showOriginalCaption();
    } else {
      void translateCaption();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#02030A] flex items-center justify-center">
        <span className="text-white/50">Loading…</span>
      </div>
    );
  }
  if (!post) {
    return (
      <div className="min-h-[100dvh] bg-[#02030A] flex items-center justify-center">
        <span className="text-white/50">Post not found</span>
      </div>
    );
  }

  const media = post.media ?? [];
  const isText = isTextPost;
  // Prefer the fully-hydrated slides over the list preview when available.
  const textPresentation = resolveTextPostPresentation(
    hydratedTextPost?.textSlides ?? post.textSlides,
    hydratedTextPost?.caption ?? post.caption,
  );
  const commentCount =
    typeof post.comments === "number"
      ? post.comments
      : post.comments?.length ?? 0;
  const metaLine =
    (post.timeAgo ?? "") + (post.location ? ` · ${post.location}` : "");

  return (
    <main className="min-h-[100dvh] bg-[#02030A] text-white">
      <div className="mx-auto max-w-[600px]">
        {/* Header: avatar + username, with time · location underneath. */}
        <header className="flex items-center gap-3 px-4 h-16">
          <button onClick={() => router.back()} aria-label="Back">
            <ArrowLeft size={22} color="#fff" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.author.avatar}
            alt=""
            className="w-10 h-10 rounded-xl object-cover bg-white/10"
          />
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-[15px]">
              @{post.author.username}
              {post.author.verified ? " ✓" : ""}
            </span>
            {metaLine ? (
              <span className="text-white/45 text-xs">{metaLine}</span>
            ) : null}
          </div>
          {/* ⋯ overflow menu — opens the action Drawer. */}
          <button
            onClick={() => setShowMenu(true)}
            className="ml-auto p-2 -mr-2"
            aria-label="More options"
          >
            <MoreHorizontal size={22} color="#fff" />
          </button>
        </header>

        {isText ? (
          // Shared surface so the detail view matches mobile (DVNT badge, glow,
          // subtitle, exact gradient) — was a bare gradient div.
          <div className="px-3 py-2">
            <TextPostSurface
              text={textPresentation.previewText || post.caption || ""}
              theme={post.textTheme}
              variant="detail"
            />
          </div>
        ) : (
          <MediaCarousel media={media} caption={post.caption ?? ""} />
        )}

        <div className="flex items-center gap-5 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[15px]">
            <button onClick={toggleLike} aria-label="Like">
              <Heart
                size={22}
                color={hasLiked ? "#ef4444" : "#fff"}
                fill={hasLiked ? "#ef4444" : "transparent"}
              />
            </button>
            {/* Tapping the count opens the who-liked sheet (native parity). */}
            <button
              onMouseEnter={() => prefetchLikesSheet(id)}
              onFocus={() => prefetchLikesSheet(id)}
              onClick={() => openLikesSheet(id)}
              className="hover:underline"
              aria-label="View likes"
              disabled={likes === 0}
            >
              {likes}
            </button>
          </div>
          <button
            onClick={() => openComposer()}
            className="flex items-center gap-1.5 text-[15px]"
            aria-label="Comment"
          >
            <MessageCircle size={22} color="#fff" />
            {commentCount}
          </button>
          <button
            onClick={() => toggleBookmark.mutate({ postId: id, isBookmarked })}
            className="ml-auto"
            aria-label="Bookmark"
          >
            <Bookmark
              size={22}
              color={isBookmarked ? "#3FDCFF" : "#fff"}
              fill={isBookmarked ? "#3FDCFF" : "transparent"}
            />
          </button>
        </div>

        {post.caption ? (
          <div className="px-4 pb-3">
            <p className="text-[15px] leading-relaxed">
              <span className="font-bold">@{post.author.username}</span>{" "}
              {translatedCaption || post.caption}
            </p>
            {/* Caption translate toggle — same hook/store native uses. Only
                shown when the caption is detectably non-English, like the
                native feed (shouldShowTranslateButton gate). */}
            {captionText && shouldShowTranslateButton(captionText, "en") ? (
              <button
                onClick={handleTranslateCaption}
                className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-[#3FDCFF]"
                aria-label={
                  isCaptionTranslated ? "Show original" : "Translate caption"
                }
              >
                <Languages size={14} color="#3FDCFF" />
                {isCaptionTranslated ? "Show original" : "Translate"}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Tagged people (Instagram-style tap-to-reveal). */}
        {!isText && postTags.length > 0 ? (
          <div className="px-4 pb-3">
            <button
              onClick={() => toggleTags(id)}
              className="text-xs font-semibold text-white/60"
              aria-label="Toggle tagged people"
            >
              {tagsVisible
                ? "Hide tagged"
                : `Tagged ${postTags.length} ${postTags.length === 1 ? "person" : "people"}`}
            </button>
            {tagsVisible ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {postTags.map((tag) => (
                  <button
                    key={`${tag.taggedUserId}-${tag.mediaIndex}`}
                    onClick={() => router.push(`/feed/${tag.username}`)}
                    className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2 py-1"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={tag.avatar}
                      alt=""
                      className="w-5 h-5 rounded-md object-cover bg-white/10"
                    />
                    <span className="text-xs font-medium">@{tag.username}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Threaded comments (Instagram-style). */}
        <section className="border-t border-white/10 pt-2 pb-28" aria-label="Comments">
          {comments && comments.length > 0 ? (
            comments.map((c) => (
              <ThreadedComment
                key={c.id}
                comment={c}
                postId={id}
                showAllReplies
                onReply={(username, commentId) =>
                  setReplyTo({ commentId, username })
                }
                onProfilePress={(username) => router.push(`/feed/${username}`)}
              />
            ))
          ) : (
            <p className="px-4 py-8 text-center text-white/40 text-sm">
              No comments yet. Be the first to comment.
            </p>
          )}
        </section>
      </div>

      <CommentComposer postId={id} />
      <Lightbox />

      {/* ⋯ action menu — kit Drawer (bottom sheet on web). */}
      <Drawer
        open={showMenu}
        onClose={() => setShowMenu(false)}
        side="bottom"
        title="Post options"
      >
        <div className="flex flex-col">
          <button
            onClick={() => {
              setShowMenu(false);
              void sharePostLink(id, post.caption ?? "");
            }}
            className="flex items-center gap-3 py-3 text-left text-[15px] text-white"
          >
            <Send size={18} color="#fff" /> Share
          </button>
          {isOwner ? (
            <button
              onClick={() => {
                setShowMenu(false);
                // Web routes are mounted under /feed — /edit-post/:id 404s.
                router.push(`/feed/edit-post/${id}`);
              }}
              className="flex items-center gap-3 py-3 text-left text-[15px] text-white"
            >
              <Pencil size={18} color="#fff" /> Edit
            </button>
          ) : null}
          {isOwner ? (
            <button
              onClick={() => {
                setShowMenu(false);
                setShowDeleteConfirm(true);
              }}
              className="flex items-center gap-3 py-3 text-left text-[15px] text-rose-500"
            >
              <Trash2 size={18} color="#f43f5e" /> Delete
            </button>
          ) : (
            <button
              onClick={() => {
                setShowMenu(false);
                openReportSheet({
                  entityType: "post",
                  entityId: id,
                  label: post.author?.username
                    ? `@${post.author.username}`
                    : undefined,
                });
              }}
              className="flex items-center gap-3 py-3 text-left text-[15px] text-rose-500"
            >
              <Flag size={18} color="#f43f5e" /> Report
            </button>
          )}
        </div>
      </Drawer>

      {/* Author-only delete confirmation — kit Dialog, real useDeletePost. */}
      <Dialog
        open={showDeleteConfirm}
        onClose={() => {
          if (!isDeleting) setShowDeleteConfirm(false);
        }}
        title="Delete post"
        footer={
          <>
            <button
              disabled={isDeleting}
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isDeleting}
              onClick={handleDelete}
              className="flex-1 rounded-xl bg-rose-500 py-3 font-semibold text-white disabled:opacity-50"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          Are you sure you want to delete this post? This can&apos;t be undone.
        </p>
        {deletePost.isError ? (
          <p className="mt-2 text-sm leading-5 text-rose-400">
            {(deletePost.error as Error)?.message || "Failed to delete post"} —
            try again.
          </p>
        ) : null}
      </Dialog>

      {/* Who-liked sheet — opened by tapping the like count. */}
      <LikesSheet
        postId={likesSheetPostId}
        onProfilePress={(username) => router.push(`/feed/${username}`)}
      />
    </main>
  );
}

export default PostDetailScreen;

/**
 * Web share — native uses expo Sharing (native module). On web we use the
 * Web Share API where available, falling back to copying the post URL.
 */
async function sharePostLink(postId: string, caption: string) {
  if (typeof window === "undefined") return;
  const url = `${window.location.origin}/post/${postId}`;
  try {
    const nav = window.navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.share) {
      await nav.share({ title: caption || "DVNT post", url });
      return;
    }
    await nav.clipboard?.writeText(url);
  } catch {
    // user cancelled / unsupported — no-op
  }
}

/**
 * LikesSheet — web "who liked" sheet rendered as a kit Drawer. Opened by
 * tapping the like count via useLikesSheet(); the list is fetched with the
 * same usePostLikers query native uses, enabled only while the sheet is open.
 */
function LikesSheet({
  postId,
  onProfilePress,
}: {
  postId: string | null;
  onProfilePress: (username: string) => void;
}) {
  const closeLikesSheet = usePostDetailUIStore((s) => s.closeLikesSheet);
  const open = !!postId;
  const { data: likers = [], isLoading } = usePostLikers(
    postId ?? undefined,
    open,
  );

  return (
    <Drawer
      open={open}
      onClose={closeLikesSheet}
      side="bottom"
      title="Likes"
    >
      {isLoading ? (
        <p className="py-8 text-center text-sm text-white/40">Loading…</p>
      ) : likers.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/40">No likes yet.</p>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {likers.map((liker) => (
            <button
              key={liker.userId}
              onClick={() => {
                closeLikesSheet();
                onProfilePress(liker.username);
              }}
              className="flex items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-white/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={liker.avatar}
                alt=""
                className="h-10 w-10 rounded-xl object-cover bg-white/10"
              />
              <div className="flex flex-col leading-tight">
                <span className="text-[15px] font-semibold">
                  @{liker.username}
                </span>
                {liker.displayName ? (
                  <span className="text-xs text-white/45">
                    {liker.displayName}
                  </span>
                ) : null}
              </div>
              <Heart
                size={16}
                color="#ef4444"
                fill="#ef4444"
                className="ml-auto"
              />
            </button>
          ))}
        </div>
      )}
    </Drawer>
  );
}

type Medium = { type?: string; url: string; thumbnail?: string };

function MediaCarousel({
  media,
  caption,
}: {
  media: Medium[];
  caption: string;
}) {
  const index = useCarouselStore((s) => s.index);
  const setIndex = useCarouselStore((s) => s.setIndex);
  const openAt = useLightboxStore((s) => s.openAt);
  const multiple = media.length > 1;
  const items = media.map((m) => ({
    type: m.type,
    url: m.url,
    poster: m.thumbnail,
  }));

  return (
    <div className="relative bg-black">
      <div
        className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {media.map((m, i) => {
          const isVid = m.type === "video" || VIDEO_URL_RE.test(m.url);
          return (
            <button
              key={i}
              onClick={() => openAt(items, i)}
              className="snap-center shrink-0 w-full relative cursor-zoom-in"
            >
              {isVid ? (
                <>
                  <video
                    src={m.url}
                    poster={m.thumbnail}
                    muted
                    playsInline
                    className="w-full max-h-[78vh] object-contain bg-black pointer-events-none"
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="w-14 h-14 rounded-2xl bg-black/55 backdrop-blur flex items-center justify-center">
                      <Play size={26} color="#fff" fill="#fff" />
                    </span>
                  </span>
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.thumbnail || m.url}
                  alt={caption}
                  className="w-full max-h-[78vh] object-contain bg-black"
                />
              )}
            </button>
          );
        })}
      </div>

      {multiple ? (
        <>
          {/* Slide counter (top-right) + pagination dots (bottom) — like mobile. */}
          <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/55 text-white text-xs font-medium">
            {Math.min(index + 1, media.length)}/{media.length}
          </div>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 pointer-events-none">
            {media.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-white" : "w-1.5 bg-white/45"
                }`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CommentComposer({ postId }: { postId: string }) {
  const open = useCommentDraftStore((s) => s.open);
  const text = useCommentDraftStore((s) => s.text);
  const replyTo = useCommentDraftStore((s) => s.replyTo);
  const setText = useCommentDraftStore((s) => s.setText);
  const reset = useCommentDraftStore((s) => s.reset);
  const user = useAuthStore((s) => s.user);
  const createComment = useCreateComment();

  // Hidden until the user taps the comment button (or Reply) — mirrors the
  // mobile comment sheet, adapted to web as a reveal-on-demand bar.
  if (!open) return null;

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    createComment.mutate({
      post: postId,
      text: body,
      parent: replyTo?.commentId,
      replyToCommentId: replyTo?.commentId,
      authorUsername: user?.username,
      authorId: user?.id,
    });
    reset();
  };

  return (
    <div className="sticky bottom-[100px] z-20 mx-auto max-w-[600px] px-3">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-white/55 bg-white/5 rounded-t-xl">
        <span>{replyTo ? `Replying to @${replyTo.username}` : "Add a comment"}</span>
        <button onClick={reset} className="font-medium" aria-label="Close composer">
          Close
        </button>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border border-white/12 bg-[#0b0d16]/95 backdrop-blur rounded-b-2xl">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={replyTo ? `Reply to @${replyTo.username}…` : "Add a comment…"}
          className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Post comment"
          className="text-[#3EA4E5] disabled:opacity-35"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
