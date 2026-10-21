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

/** Compact source identity and actions, separate from the story publisher. */
export function StorySharedSourceCard({
  source,
  profilePath,
  viewersAction,
  onNavigate,
}: {
  source: StorySharedSource;
  profilePath: string | null;
  viewersAction?: ReactNode;
  onNavigate: (path: string) => void;
}) {
  const authorName = source.author.name || `@${source.author.username}`;
  const AuthorTag = profilePath ? "a" : "div";
  const sourcePath = storySourcePath(source);
  const navigate = (event: React.MouseEvent<HTMLElement>, path: string) => {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onNavigate(path);
  };

  return (
    <section
      data-story-source-card
      aria-label={`Shared ${source.type} by @${source.author.username}`}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-white/20 bg-black/65 p-3 text-white backdrop-blur-md"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <AuthorTag
        href={profilePath || undefined}
        onClick={
          profilePath
            ? (event: React.MouseEvent<HTMLElement>) =>
                navigate(event, profilePath)
            : undefined
        }
        aria-label={
          profilePath
            ? `View @${source.author.username}'s profile`
            : "Original author profile unavailable"
        }
        className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/15 text-sm font-bold">
          {source.author.username.slice(0, 1).toUpperCase()}
          {source.author.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={source.author.avatar}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
          ) : null}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold" title={authorName}>
            {authorName}
          </span>
          <span className="block truncate text-xs text-white/70">
            {profilePath
              ? `@${source.author.username} · Original ${source.type}`
              : "Profile unavailable"}
          </span>
          {source.title ? (
            <span className="block truncate text-xs font-medium" title={source.title}>
              {source.title}
            </span>
          ) : null}
        </span>
      </AuthorTag>
      <div data-story-source-actions className="flex min-w-0 items-center justify-between gap-2">
        {viewersAction}
        <a
          href={sourcePath}
          onClick={(event) => navigate(event, sourcePath)}
          className="ml-auto inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-white/15 px-3 text-xs font-semibold hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
        >
          {source.type === "event" ? "View Event" : "View Post"}
        </a>
      </div>
    </section>
  );
}
