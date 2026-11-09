import { useLayoutEffect, useRef } from "react";
import { resetPostAccessOverlays } from "@dvnt/app/lib/posts/revoke-post-overlays";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
interface ProtectedPost {
  isNSFW?: boolean;
  isSpicyLocked?: boolean;
  spicyAccessViewerId?: string | null;
}
/** Missing, revoked or another viewer's authorization must never mount content. */
export function isSpicyPostLocked(
  post: ProtectedPost,
  viewerId = useAuthStore.getState().user?.authId,
) {
  return (
    post.isSpicyLocked === true ||
    (post.isNSFW === true &&
      (post.isSpicyLocked !== false ||
        !viewerId ||
        post.spicyAccessViewerId !== viewerId))
  );
}
export function useSpicyPostLocked(post: ProtectedPost) {
  const viewerId = useAuthStore((s) => s.user?.authId);
  const locked = isSpicyPostLocked(post, viewerId);
  const previous = useRef(locked);
  useLayoutEffect(() => {
    if (locked && !previous.current) resetPostAccessOverlays();
    previous.current = locked;
  }, [locked]);
  return locked;
}
