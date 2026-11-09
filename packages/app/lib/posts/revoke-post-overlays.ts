import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useLightboxStore } from "@dvnt/app/lib/stores/lightbox-store";
import { useWebPostShareStore } from "@dvnt/app/lib/stores/web-post-share-store";
import { useFeedPostUIStore } from "@dvnt/app/lib/stores/feed-post-store";

/** Erase detached media, not just query caches, before an access change. */
export function resetPostAccessOverlays() {
  useLightboxStore.getState().close();
  useWebPostShareStore.getState().close();
  useFeedPostUIStore.setState({
    previewMedia: null,
    showPreviewModal: false,
    videoStates: {},
    activePostId: null,
    actionSheetPostId: null,
    shareSheetPostId: null,
    commentsSheetPostId: null,
    firstPageImagesPrefetched: false,
  });
}

// Zustand notifies synchronously, so an account switch erases these independent
// stores even when the originating post component has already unmounted.
useAuthStore.subscribe((current, previous) => {
  if (current.user?.authId !== previous.user?.authId) resetPostAccessOverlays();
});
