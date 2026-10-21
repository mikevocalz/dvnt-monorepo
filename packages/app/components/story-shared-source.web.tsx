"use client";

import type { StorySharedSource } from "../lib/types";
import { storySourcePath } from "../lib/stories/shared-source";

/** Separate source identity from the member whose story is playing. */
export function StorySharedSourceCard({
  source,
  profilePath,
  isSourceCard = false,
  onNavigate,
}: {
  source: StorySharedSource;
  profilePath: string | null;
  isSourceCard?: boolean;
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
      aria-label={`Shared ${source.type} by @${source.author.username}`}
      className={
        isSourceCard
          ? "absolute inset-x-5 top-[20%] bottom-40 flex flex-col overflow-hidden rounded-2xl border border-fuchsia-300/30 bg-gradient-to-br from-[#1A0A2E] via-[#8A40CF] to-[#34A2DF] p-5 text-white shadow-xl"
          : "absolute left-4 right-14 top-20 rounded-xl border border-white/20 bg-black/65 p-3 text-white backdrop-blur-md"
      }
      style={{ zIndex: 100000 }}
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
        className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-white"
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
          <span className="block truncate text-sm font-semibold">
            {authorName}
          </span>
          <span className="block truncate text-xs text-white/70">
            {profilePath
              ? `@${source.author.username} · Original ${source.type}`
              : "Profile unavailable"}
          </span>
        </span>
      </AuthorTag>
      {source.title ? (
        <p className="mt-3 line-clamp-2 shrink-0 text-lg font-semibold">
          {source.title}
        </p>
      ) : null}
      {isSourceCard ? (
        <>
          <p className="mt-4 min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-words text-xl font-semibold leading-relaxed">
            {source.caption ||
              (source.type === "post"
                ? "View the original post"
                : "You're invited")}
          </p>
          <p className="mt-3 shrink-0 text-xs font-bold tracking-[0.25em] text-white/70">
            DVNT
          </p>
        </>
      ) : null}
      <a
        href={sourcePath}
        onClick={(event) => navigate(event, sourcePath)}
        className="mt-3 inline-flex shrink-0 self-start rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
      >
        View original {source.type} ↗
      </a>
    </section>
  );
}
