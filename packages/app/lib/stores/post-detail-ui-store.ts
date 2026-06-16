/**
 * UI/transient state for the WEB post-detail screen.
 *
 * The native post screen (app/(protected)/post/[id].tsx) keeps these flags in
 * a mix of `useState` and dedicated stores (post-detail-screen-store, an
 * app-root LikesSheet context). The web port can't use the native app-root
 * BottomSheet controller, so per the project's Zustand-always rule we lift all
 * the menu / confirm-dialog / likes-sheet UI flags into this one store.
 *
 *   - showMenu          → the ⋯ overflow menu (Drawer)
 *   - showDeleteConfirm → author-only Delete confirmation (Dialog)
 *   - likesSheetPostId  → which post's "who liked" sheet is open (null = closed)
 *
 * A thin `useLikesSheet()` hook (below) mirrors the native controller's
 * `{ open, close, prefetch, activePostId }` API so callers wire identically.
 */

import { create } from "zustand";
import { useCallback } from "react";
import { usePrefetchPostLikers } from "@dvnt/app/lib/hooks/use-post-likers";

interface PostDetailUIState {
  showMenu: boolean;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
  /** postId whose likes sheet is open, or null when closed. */
  likesSheetPostId: string | null;

  setShowMenu: (v: boolean) => void;
  setShowDeleteConfirm: (v: boolean) => void;
  setIsDeleting: (v: boolean) => void;
  openLikesSheet: (postId: string) => void;
  closeLikesSheet: () => void;
  reset: () => void;
}

export const usePostDetailUIStore = create<PostDetailUIState>((set) => ({
  showMenu: false,
  showDeleteConfirm: false,
  isDeleting: false,
  likesSheetPostId: null,

  setShowMenu: (v) => set({ showMenu: v }),
  setShowDeleteConfirm: (v) => set({ showDeleteConfirm: v }),
  setIsDeleting: (v) => set({ isDeleting: v }),
  openLikesSheet: (postId) => set({ likesSheetPostId: postId }),
  closeLikesSheet: () => set({ likesSheetPostId: null }),
  reset: () =>
    set({
      showMenu: false,
      showDeleteConfirm: false,
      isDeleting: false,
      likesSheetPostId: null,
    }),
}));

/**
 * useLikesSheet — web mirror of the native LikesSheetController hook.
 *
 * Returns the same `{ open, close, prefetch, activePostId }` surface the
 * native screen consumes, but backed by this Zustand store + React Query
 * prefetch instead of an app-root BottomSheet context (which can't mount on
 * web). The actual "who liked" list renders via the kit Drawer in the screen,
 * driven by `activePostId`.
 */
export function useLikesSheet() {
  const open = usePostDetailUIStore((s) => s.openLikesSheet);
  const close = usePostDetailUIStore((s) => s.closeLikesSheet);
  const activePostId = usePostDetailUIStore((s) => s.likesSheetPostId);
  const prefetchLikers = usePrefetchPostLikers();

  const prefetch = useCallback(
    (postId: string) => prefetchLikers(postId),
    [prefetchLikers],
  );

  return { open, close, prefetch, activePostId };
}
