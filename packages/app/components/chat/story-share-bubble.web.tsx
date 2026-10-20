import type { StoryShareContext } from "@dvnt/app/lib/messages/story-share";
import { storyShareSourcePath } from "@dvnt/app/lib/messages/story-share";

/** The native client can still read the stored plain-text message. */
export function StoryShareBubble({
  share,
  isOwnMessage,
}: {
  share: StoryShareContext;
  isOwnMessage: boolean;
}) {
  const href = storyShareSourcePath(share);
  return (
    <div className="max-w-72 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white">
      <p>
        {isOwnMessage
          ? `You shared this ${share.sourceType} to your story.`
          : `Shared your ${share.sourceType} to their story.`}
      </p>
      {share.sourceTitle ? (
        <p className="mt-1 line-clamp-2 text-white/60">{share.sourceTitle}</p>
      ) : null}
      {href ? (
        <a
          href={href}
          className="mt-2 inline-block rounded-sm text-[#3FDCFF] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3FDCFF]"
        >
          View {share.sourceType}
        </a>
      ) : null}
    </div>
  );
}
