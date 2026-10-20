import { useEffect, useRef } from "react";
import { useCreateStory } from "./use-stories";
import { useVerifiedGate } from "./use-verified-gate";
import { useAuthStore } from "../stores/auth-store";
import { useUIStore } from "../stores/ui-store";
import { postStoryItem } from "../posts/share-post";
import type { Post } from "../types";

export function useSharePostToStory() {
  const createStory = useCreateStory();
  const guardVerified = useVerifiedGate();
  const showToast = useUIStore((s) => s.showToast);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const share = (
    post: Pick<Post, "media"> | null | undefined,
    onShared?: () => void,
  ) => {
    if (inFlight.current) return;
    const viewerId = useAuthStore.getState().user?.id;
    if (!viewerId) {
      showToast(
        "error",
        "Sign in to share",
        "Sign in to add a post to your story.",
      );
      return;
    }
    const item = postStoryItem(post);
    if (!item) {
      showToast(
        "error",
        "No media to share",
        "Only posts with photos or videos can be added to a story.",
      );
      return;
    }
    guardVerified("post", () => {
      if (
        !mounted.current ||
        inFlight.current ||
        useAuthStore.getState().user?.id !== viewerId
      )
        return;
      inFlight.current = true;
      void createStory
        .mutateAsync({ items: [item], expectedViewerId: viewerId })
        .then(() => {
          if (useAuthStore.getState().user?.id !== viewerId) return;
          showToast("success", "Added to your story", "");
          if (mounted.current) onShared?.();
        })
        .catch(() => {
          if (useAuthStore.getState().user?.id !== viewerId) return;
          showToast(
            "error",
            "Share failed",
            "Couldn't add this post to your story. Please try again.",
          );
        })
        .finally(() => {
          inFlight.current = false;
        });
    });
  };

  return { share, isPending: createStory.isPending };
}
