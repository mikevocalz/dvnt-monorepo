"use client";

/**
 * KLIPY gif picker for the room chat. Web variant of the sticker sheet:
 * same klipySearch / URI helpers, plain <img> grid, required attribution
 * rendered inline (the RN KlipyAttribution uses react-native primitives, so
 * the web picker renders the same required label as HTML).
 */

import { useEffect, useRef, useState } from "react";
import {
  klipySearch,
  getItemPreviewUri,
  getItemImageUri,
  type KlipyItem,
} from "../../stickers/api/klipy";

export interface GifPayload {
  id: string;
  url: string;
  preview_url: string;
  width: number;
  height: number;
  provider: "klipy";
}

export function KlipyGifPicker({
  onPick,
}: {
  onPick: (gif: GifPayload) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<KlipyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    const t = window.setTimeout(
      () => {
        void klipySearch("gifs", query, { limit: 24, signal: ctrl.signal })
          .then((res) => {
            if (ctrl.signal.aborted) return;
            setItems(res.results);
            setIsFallback(res.source === "fallback");
            setLoading(false);
          })
          .catch(() => {
            if (!ctrl.signal.aborted) setLoading(false);
          });
      },
      query ? 300 : 0,
    );
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search KLIPY"
          aria-label="Search KLIPY gifs"
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-[#8A40CF] focus:outline-none"
        />
      </div>
      <div
        className="grid flex-1 grid-cols-3 gap-1.5 overflow-y-auto p-2"
        aria-busy={loading}
      >
        {items.map((item) => {
          const preview = getItemPreviewUri(item, "gifs");
          if (!preview) return null;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.content_description || item.title || "GIF"}
              onClick={() => {
                const url = getItemImageUri(item, "gifs");
                if (!url) return;
                const fmt =
                  item.media_formats.gif ?? item.media_formats.webp;
                onPick({
                  id: item.id,
                  url,
                  preview_url: preview,
                  width: fmt?.width ?? 0,
                  height: fmt?.height ?? 0,
                  provider: "klipy",
                });
              }}
              className="overflow-hidden rounded-lg border border-transparent transition-colors hover:border-[#8A40CF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A2F0]"
            >
              <img
                src={preview}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            </button>
          );
        })}
        {!loading && items.length === 0 ? (
          <p className="col-span-3 py-6 text-center text-sm text-white/45">
            No GIFs found.
          </p>
        ) : null}
      </div>
      {/* Required wherever Klipy content is shown; hidden for the built-in
          fallback set, which is not Klipy content. */}
      {!isFallback ? (
        <p className="border-t border-white/10 px-3 py-1.5 text-center text-[11px] font-semibold tracking-wide text-white/45">
          Powered by KLIPY
        </p>
      ) : null}
    </div>
  );
}
