"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { create } from "zustand";
import type { CommentAttachment } from "@dvnt/app/lib/types";
import { commentGifFromItem, isCommentGif } from "../gif-attachment";
import { klipySearch } from "../../stickers/api/klipy";

const subscribeMotion = (notify: () => void) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const getMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Never load an animated asset automatically when reduced motion is requested. */
export function CommentGif({
  attachment,
  preview = false,
  interactive = true,
}: {
  attachment: CommentAttachment;
  preview?: boolean;
  interactive?: boolean;
}) {
  const reduced = useSyncExternalStore(subscribeMotion, getMotion, () => true);
  const useGifState = useMemo(
    () =>
      create<{ playing: boolean; failed: boolean }>(() => ({
        playing: false,
        failed: false,
      })),
    [attachment.url],
  );
  const { playing, failed } = useGifState();
  if (!isCommentGif(attachment))
    return <span className="text-sm text-white/60">GIF unavailable</span>;
  const width = Math.min(attachment.width, 240);
  const height = Math.min((width * attachment.height) / attachment.width, 280);
  return (
    <figure className="my-2 max-w-full" style={{ width }}>
      {failed ? (
        <div
          role="status"
          className="rounded-xl bg-white/5 p-3 text-sm text-white/60"
        >
          GIF unavailable: {attachment.title}
        </div>
      ) : reduced && !playing && !interactive ? (
        <div
          className="rounded-xl bg-white/10 p-3 text-sm text-white"
          style={{ minHeight: 80 }}
        >
          {attachment.title}
        </div>
      ) : reduced && !playing ? (
        <button
          type="button"
          className="w-full rounded-xl bg-white/10 p-3 text-sm text-white"
          style={{ minHeight: Math.min(height, 120) }}
          onClick={() => useGifState.setState({ playing: true })}
        >
          Play GIF: {attachment.title}
        </button>
      ) : (
        <img
          src={preview ? attachment.previewUrl : attachment.url}
          alt={attachment.title || "GIF"}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="max-w-full rounded-xl object-contain"
          style={{ height }}
          onError={() => useGifState.setState({ failed: true })}
        />
      )}
      <figcaption className="mt-1 text-xs text-white/45">
        {attachment.provider === "noto"
          ? "Google Noto Emoji"
          : "Powered by KLIPY"}
      </figcaption>
      {reduced && playing && !failed && (
        <button
          type="button"
          className="text-xs text-white/65"
          onClick={() => useGifState.setState({ playing: false })}
        >
          Stop GIF
        </button>
      )}
    </figure>
  );
}

type PickerState = {
  query: string;
  items: CommentAttachment[];
  next?: string;
  loading: boolean;
  failed: boolean;
  source?: string;
  revision: number;
};
export function CommentGifPicker({
  onSelect,
  onClose,
}: {
  onSelect: (attachment: CommentAttachment) => void;
  onClose: () => void;
}) {
  const useGifState = useMemo(
    () =>
      create<PickerState>(() => ({
        query: "",
        items: [],
        loading: true,
        failed: false,
        revision: 0,
      })),
    [],
  );
  const state = useGifState();
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const load = async (next?: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++generation.current;
    useGifState.setState({ loading: true, failed: false });
    try {
      const result = await klipySearch("gifs", useGifState.getState().query, {
        limit: 24,
        next,
        signal: controller.signal,
      });
      if (controller.signal.aborted || generation.current !== version) return;
      const items = result.results.flatMap((item) => {
        const attachment = commentGifFromItem(item, result.source);
        return attachment ? [attachment] : [];
      });
      useGifState.setState((current) => ({
        items:
          next && current.source === result.source
            ? [
                ...current.items,
                ...items.filter(
                  (item) =>
                    !current.items.some(
                      (old) =>
                        old.id === item.id && old.provider === item.provider,
                    ),
                ),
              ]
            : items,
        next: result.next,
        source: result.source,
        loading: false,
      }));
    } catch (error) {
      if (!controller.signal.aborted && generation.current === version)
        useGifState.setState({ loading: false, failed: true });
    }
  };
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    request.current?.abort();
    generation.current++;
    useGifState.setState({ items: [], next: undefined, loading: true });
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [state.query, state.revision]);
  return (
    <section
      aria-label="Choose a GIF"
      className="border-t border-white/10 p-3"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex gap-2">
        <input
          ref={input}
          aria-label="Search GIFs"
          value={state.query}
          maxLength={100}
          onChange={(event) =>
            useGifState.setState({ query: event.target.value })
          }
          className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-white"
          placeholder="Search GIFs"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF picker"
          className="text-sm text-white/65"
        >
          Close
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto" aria-busy={state.loading}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {state.items.map((item) => (
            <button
              key={`${item.provider}:${item.id}`}
              type="button"
              aria-label={`Choose ${item.title}`}
              onClick={() => onSelect(item)}
              className="min-w-0 rounded-lg border border-white/10 p-1 text-left focus-visible:outline focus-visible:outline-2"
            >
              <CommentGif attachment={item} preview interactive={false} />
            </button>
          ))}
        </div>
        {state.loading && (
          <p role="status" className="py-3 text-sm text-white/65">
            Loading GIFs…
          </p>
        )}
        {!state.loading && !state.failed && !state.items.length && (
          <p role="status" className="py-3 text-sm text-white/65">
            No GIFs found. Try another search.
          </p>
        )}
        {state.failed && (
          <p role="alert" className="py-3 text-sm text-white/65">
            GIFs could not load.{" "}
            <button
              type="button"
              onClick={() =>
                useGifState.setState((s) => ({ revision: s.revision + 1 }))
              }
            >
              Retry
            </button>
          </p>
        )}
        {state.next && !state.loading && (
          <button
            type="button"
            onClick={() => void load(state.next)}
            className="w-full py-3 text-sm text-white"
          >
            Load more GIFs
          </button>
        )}
      </div>
      <p className="pt-2 text-xs text-white/50">
        {state.source === "fallback"
          ? "GIF search unavailable. Showing Google Noto Emoji."
          : "Powered by KLIPY"}
      </p>
    </section>
  );
}
