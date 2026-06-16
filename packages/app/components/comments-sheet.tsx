import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

interface CommentsSheetProps {
  visible: boolean;
  onClose: () => void;
  postId: string | null;
}

/**
 * Legacy compatibility bridge.
 * The active comments experience now lives in the routed True Sheet stack.
 */
export function CommentsSheet({
  visible,
  onClose,
  postId,
}: CommentsSheetProps) {
  const router = useRouter();
  const lastRoutedPostId = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || !postId) {
      lastRoutedPostId.current = null;
      return;
    }

    if (lastRoutedPostId.current === postId) return;
    lastRoutedPostId.current = postId;
    router.push(`/(protected)/comments/${postId}` as any);
    onClose();
  }, [onClose, postId, router, visible]);

  return null;
}
