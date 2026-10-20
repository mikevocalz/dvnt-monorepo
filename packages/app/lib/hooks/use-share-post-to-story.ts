import { useEffect, useRef } from "react";
import { useCreateStory } from "./use-stories";
import { useVerifiedGate } from "./use-verified-gate";
import { useAuthStore } from "../stores/auth-store";
import { useUIStore } from "../stores/ui-store";
import type { Post } from "../types";
import {
  startStoryShareOperation,
  finishStoryShareOperation,
} from "../stories/share-operation";

export function useSharePostToStory() {
  const createStory = useCreateStory();
  const guardVerified = useVerifiedGate();
  const showToast = useUIStore((s) => s.showToast);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const identityEpoch = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (
        state.user?.id !== previous.user?.id ||
        state.user?.authId !== previous.user?.authId
      )
        identityEpoch.current++;
    });
    return () => {
      mounted.current = false;
      identityEpoch.current++;
      unsubscribe();
    };
  }, []);

  const shareSource = (
    source: { type: "post" | "event"; id: string },
    onShared?: () => void,
  ) => {
    if (inFlight.current) return;
    const viewer = useAuthStore.getState().user;
    const viewerId = viewer?.id;
    if (!viewerId) {
      showToast(
        "error",
        "Sign in to share",
        "Sign in to add this to your story.",
      );
      return;
    }
    if (!/^[1-9]\d*$/.test(source.id)) {
      showToast(
        "error",
        "Can't share yet",
        "This item is not available to share.",
      );
      return;
    }
    const epoch = identityEpoch.current;
    const isCurrent = () =>
      mounted.current &&
      identityEpoch.current === epoch &&
      useAuthStore.getState().user?.id === viewerId;
    guardVerified("post", () => {
      if (!isCurrent() || inFlight.current) return;
      const key = JSON.stringify([
        viewerId,
        viewer.authId,
        source.type,
        source.id,
      ]);
      const activeOperation = startStoryShareOperation(key);
      if (!activeOperation) return;
      inFlight.current = true;
      void createStory
        .mutateAsync({
          sharedSource: source,
          operationId: activeOperation.id,
          expectedViewerId: viewerId,
          isCurrent,
        })
        .then(() => {
          finishStoryShareOperation(activeOperation, true);
          if (!isCurrent()) return;
          showToast("success", "Added to your story", "");
          onShared?.();
        })
        .catch(() => {
          if (!isCurrent()) return;
          showToast(
            "error",
            "Share failed",
            "Couldn't add this to your story. Please try again.",
          );
        })
        .finally(() => {
          finishStoryShareOperation(activeOperation, false);
          inFlight.current = false;
        });
    });
  };

  const share = (
    post: Pick<Post, "id"> | null | undefined,
    onShared?: () => void,
  ) => {
    if (post) shareSource({ type: "post", id: String(post.id) }, onShared);
  };
  const shareEvent = (
    event: { id: string | number } | null | undefined,
    onShared?: () => void,
  ) => {
    if (event) shareSource({ type: "event", id: String(event.id) }, onShared);
  };

  return { share, shareEvent, isPending: createStory.isPending };
}
