"use client";

import type { ReactNode } from "react";
import type { StorySharedSource } from "../lib/types";
import { storySourcePath } from "../lib/stories/shared-source";

/** Text-only shares keep their content in the story, not in the footer. */
export function StorySharedSourceContent({
  source,
}: {
  source: StorySharedSource;
}) {
  return (
    <section
      aria-label={`Shared ${source.type} content`}
      tabIndex={0}
      className="pointer-events-auto mx-5 mb-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-fuchsia-300/30 bg-gradient-to-br from-[#1A0A2E] via-[#8A40CF] to-[#34A2DF] p-4 text-white shadow-xl focus-visible:outline-2 focus-visible:outline-white"
      onKeyDown={(event) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
          event.stopPropagation();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {source.title ? (
        <p className="mb-3 line-clamp-2 text-lg font-semibold">
          {source.title}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap break-words text-xl font-semibold leading-relaxed">
        {source.caption ||
          (source.type === "post"
            ? "View the original post"
            : "You're invited")}
      </p>
      <p className="mt-3 text-xs font-bold tracking-[0.25em] text-white/70">
        DVNT
      </p>
    </section>
  );
}

/** Only footer actions are visible; source identity remains in the metadata. */
export function StorySharedSourceActions({
  source,
  viewersAction,
  onNavigate,
}: {
  source: StorySharedSource;
  viewersAction?: ReactNode;
  onNavigate: (path: string) => void;
}) {
  const sourcePath = storySourcePath(source);

  return (
    <section
      data-story-source-actions
      aria-label={`Shared ${source.type} by @${source.author.username}`}
      className="flex min-w-0 items-center justify-between gap-2 text-white"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {viewersAction}
      <a
        href={sourcePath}
        onClick={(event) => {
          event.stopPropagation();
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          onNavigate(sourcePath);
        }}
        className="ml-auto inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-white/15 bg-black/45 px-3 text-xs font-semibold backdrop-blur-md hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white"
      >
        {source.type === "event" ? "View Event" : "View Post"}
      </a>
    </section>
  );
}
