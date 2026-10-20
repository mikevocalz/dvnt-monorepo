import { ImagePlus } from "lucide-react";
import { useSharePostToStory } from "@dvnt/app/lib/hooks/use-share-post-to-story";
import { isPubliclyListableEvent } from "@dvnt/app/lib/events/event-discovery";

/** Public story shares must not disclose invite-only or unpublished events. */
export function ShareEventToStoryMenuItem({
  event,
  onShared,
}: {
  event: {
    id: string | number;
    visibility?: string | null;
    status?: string | null;
    isHidden?: boolean;
    publishAt?: string | null;
  };
  onShared?: () => void;
}) {
  const shareToStory = useSharePostToStory();
  if (
    !isPubliclyListableEvent({
      id: event.id,
      visibility: event.visibility,
      status: event.status,
      is_hidden: event.isHidden,
      publish_at: event.publishAt,
    })
  )
    return null;
  return (
    <button
      type="button"
      disabled={shareToStory.isPending}
      onClick={() => shareToStory.shareEvent(event, onShared)}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-white hover:bg-white/5 disabled:opacity-50"
    >
      <ImagePlus size={16} />
      {shareToStory.isPending ? "Sharing…" : "Share to Story"}
    </button>
  );
}
