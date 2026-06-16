/**
 * Location detail — WEB variant of native
 * `app/(protected)/location/[placeId].tsx`.
 *
 * Instagram-style location page: a map preview header + a masonry grid of the
 * posts tagged at this place. DATA WIRING IS A VERBATIM PORT of the native
 * screen — same `searchApi.searchPostsByLocation` call keyed the same way, the
 * same `locationMatches` / `getLocationMatchTerms` filter, and the same
 * `NormalizedLocation` derivation. Native used react-native-maps via `DvntMap`;
 * here the read-only map is the @dvnt/ui `MapPicker` (readOnly). Lists on web =
 * TanStack Virtual (masonry lanes). State = Zustand (no useState). Styling = raw
 * semantic tags + Tailwind only. bg #06070d, accent cyan #3FDCFF.
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useWindowDimensions } from "react-native";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useParams, useRouter, useSearchParams } from "solito/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Navigation, Play, Grid3x3 } from "lucide-react";
import { MapPicker } from "@dvnt/ui";
import { searchApi } from "@dvnt/app/lib/api/search";
import { hasValidCoordinates } from "@dvnt/app/lib/utils/location";
import type { NormalizedLocation } from "@dvnt/app/lib/types/location";
import type { Post } from "@dvnt/app/lib/types";
import { create } from "zustand";

const GAP = 8;
const MAX_W = 935;

// ----- location-matching helpers (verbatim from the native screen) -----
function normalizeLocationTerm(value?: string | string[] | null) {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocationMatchTerms(
  parts: Array<string | string[] | null | undefined>,
) {
  const terms = new Set<string>();
  for (const part of parts) {
    const normalized = normalizeLocationTerm(part);
    if (!normalized) continue;
    terms.add(normalized);
    const firstSegment = normalized.split(",")[0]?.trim();
    if (firstSegment) terms.add(firstSegment);
  }
  return Array.from(terms).filter((term) => term.length >= 2);
}

function locationMatches(postLocation: string | undefined, terms: string[]) {
  if (!postLocation || terms.length === 0) return false;
  const normalizedLocation = normalizeLocationTerm(postLocation);
  if (!normalizedLocation) return false;
  const locationVariants = new Set<string>([normalizedLocation]);
  const firstSegment = normalizedLocation.split(",")[0]?.trim();
  if (firstSegment) locationVariants.add(firstSegment);
  return terms.some((term) =>
    Array.from(locationVariants).some(
      (candidate) => candidate.includes(term) || term.includes(candidate),
    ),
  );
}

// Derived NormalizedLocation lives in a Zustand store (no useState per HARD
// CONVENTIONS). Mirrors the native `setLocation` effect.
interface LocationDetailState {
  location: NormalizedLocation | null;
  setLocation: (location: NormalizedLocation | null) => void;
}
const useLocationDetailStore = create<LocationDetailState>((set) => ({
  location: null,
  setLocation: (location) => set({ location }),
}));

// Deterministic per-post aspect — same heuristic as the home masonry.
const VARIATION = 0.3;
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h % 1000) / 1000;
}
function estimateRatio(post: Post): number {
  const media = post.media?.[0];
  let base = 1.2;
  if (media?.type === "video") base = 1.5;
  else if (post.hasMultipleImages || (post.media?.length ?? 0) > 1) base = 1.0;
  else if (media?.type === "gif") base = 0.75;
  return base + (hashId(post.id) * 2 - 1) * VARIATION;
}
const VIDEO_URL_RE =
  /post-video|\.mp4(\?|$)|\.mov(\?|$)|\.m3u8(\?|$)|\.webm(\?|$)/i;
function coverFor(post: Post): string {
  const m = post.media?.[0];
  const candidates = [post.thumbnail, m?.thumbnail, m?.url];
  for (const c of candidates) {
    if (c && !VIDEO_URL_RE.test(c)) return c;
  }
  return "";
}

function columnsFor(width: number): number {
  if (width >= 900) return 4;
  if (width >= 640) return 3;
  return 2;
}

export function LocationDetailScreen() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const placeId = String((params as any)?.placeId ?? "");
  const name = search?.get("name") ?? undefined;
  const formattedAddress = search?.get("formattedAddress") ?? undefined;
  const latitude = search?.get("latitude") ?? undefined;
  const longitude = search?.get("longitude") ?? undefined;

  const routeLocationName =
    normalizeLocationTerm(name) || normalizeLocationTerm(placeId);
  const locationMatchTerms = useMemo(
    () => getLocationMatchTerms([name, formattedAddress, placeId]),
    [name, formattedAddress, placeId],
  );
  const locationSearchLabel = name || formattedAddress || placeId || "";
  const parsedLatitude = latitude ? Number(latitude) : NaN;
  const parsedLongitude = longitude ? Number(longitude) : NaN;

  // Posts at this location — EXACT native query (key + queryFn + filter).
  const {
    data: posts = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: [
      "posts",
      "by-location",
      placeId,
      normalizeLocationTerm(name),
      normalizeLocationTerm(formattedAddress),
    ],
    queryFn: async () => {
      const searchResults =
        await searchApi.searchPostsByLocation(locationSearchLabel);
      return searchResults.docs.filter((post) =>
        locationMatches(post.location, locationMatchTerms),
      );
    },
    enabled:
      locationMatchTerms.length > 0 && locationSearchLabel.trim().length >= 2,
    staleTime: 2 * 60 * 1000,
  });

  const location = useLocationDetailStore((s) => s.location);
  const setLocation = useLocationDetailStore((s) => s.setLocation);

  // Derive NormalizedLocation — verbatim port of the native effect.
  useEffect(() => {
    if (routeLocationName) {
      setLocation({
        placeId,
        provider: "google",
        name: name || routeLocationName,
        formattedAddress: formattedAddress || name || routeLocationName,
        latitude: Number.isFinite(parsedLatitude) ? parsedLatitude : 0,
        longitude: Number.isFinite(parsedLongitude) ? parsedLongitude : 0,
      });
      return;
    }
    if (posts.length > 0 && posts[0].location) {
      setLocation({
        placeId,
        provider: "google",
        name: posts[0].location.split(",")[0] || posts[0].location,
        formattedAddress: posts[0].location,
        latitude: 0,
        longitude: 0,
      });
    }
  }, [
    formattedAddress,
    name,
    parsedLatitude,
    parsedLongitude,
    placeId,
    posts,
    routeLocationName,
    setLocation,
  ]);

  const hasCoords = hasValidCoordinates(location);

  const handleGetDirections = () => {
    if (location && hasValidCoordinates(location)) {
      const coords = `${location.latitude},${location.longitude}`;
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${coords}`,
        "_blank",
        "noopener,noreferrer",
      );
    }
  };

  // ----- masonry grid (TanStack Virtual lanes) -----
  const { width: winW } = useWindowDimensions();
  const containerWidth = Math.min(winW - 16, MAX_W);
  const numColumns = columnsFor(winW);
  const columnWidth = Math.floor(
    (containerWidth - (numColumns - 1) * GAP) / numColumns,
  );
  const cellHeight = (post: Post) =>
    Math.round(estimateRatio(post) * columnWidth);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: posts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => cellHeight(posts[i]) + GAP,
    overscan: 8,
    lanes: numColumns,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [numColumns, columnWidth, virtualizer]);

  const items = virtualizer.getVirtualItems();

  const openPost = (post: Post) =>
    router.push(
      `/feed/${encodeURIComponent(post.author.username)}/post/${encodeURIComponent(post.id)}`,
    );

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto bg-[#06070d] text-white"
      style={{ height: "100dvh" }}
    >
      {/* Sticky header */}
      <header
        className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 -ml-1 rounded-xl flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={22} color="#fff" />
        </button>
        <h1 className="flex-1 truncate text-[17px] font-semibold">Location</h1>
        {location && hasCoords ? (
          <button
            onClick={handleGetDirections}
            aria-label="Get directions"
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
          >
            <Navigation size={20} color="#3FDCFF" />
          </button>
        ) : null}
      </header>

      <div className="mx-auto w-full" style={{ maxWidth: MAX_W }}>
        {/* Map preview header */}
        {location ? (
          <section className="relative">
            {hasCoords ? (
              <MapPicker
                value={{
                  lat: location.latitude,
                  lng: location.longitude,
                }}
                readOnly
                zoom={15}
                height={200}
              />
            ) : (
              <div className="h-32 w-full flex items-center justify-center bg-white/5">
                <MapPin size={40} color="rgba(255,255,255,0.4)" />
              </div>
            )}
            {/* Info overlay */}
            <div className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-10 pointer-events-none">
              <span className="absolute inset-0 bg-linear-to-t from-black/80 to-transparent" />
              <h2 className="relative truncate text-2xl font-bold text-white">
                {location.name}
              </h2>
              {location.city ? (
                <p className="relative truncate text-sm text-white/80">
                  {location.city}
                  {location.country ? `, ${location.country}` : ""}
                </p>
              ) : null}
              <p className="relative mt-1 text-xs text-white/60">
                {posts.length} {posts.length === 1 ? "post" : "posts"}
              </p>
            </div>
          </section>
        ) : null}

        {/* Posts grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <span className="w-10 h-10 rounded-full border-2 border-[#3FDCFF] border-t-transparent animate-spin" />
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center px-8 py-24">
            <p className="text-center text-white/60">
              Failed to load posts. Please try again.
            </p>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 py-24">
            <MapPin size={48} color="rgba(255,255,255,0.4)" />
            <p className="mt-4 text-center text-white/60">
              No posts at this location yet
            </p>
            <p className="mt-2 text-center text-sm text-white/40">
              Be the first to post here!
            </p>
          </div>
        ) : (
          <section
            className="relative mx-auto"
            style={{
              width: containerWidth,
              height: virtualizer.getTotalSize(),
              paddingTop: GAP,
            }}
            aria-label="Posts at this location"
          >
            {items.map((item) => {
              const post = posts[item.index];
              if (!post) return null;
              const cover = coverFor(post);
              const isVideo = post.media?.[0]?.type === "video";
              const isCarousel =
                post.hasMultipleImages || (post.media?.length ?? 0) > 1;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: item.lane * (columnWidth + GAP),
                    width: columnWidth,
                    transform: `translateY(${item.start}px)`,
                    paddingBottom: GAP,
                  }}
                >
                  <div
                    onClick={() => openPost(post)}
                    role="button"
                    className="group relative overflow-hidden rounded-xl bg-white/5 cursor-pointer"
                  >
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover}
                        alt={post.caption ?? ""}
                        loading="lazy"
                        className="block w-full h-auto"
                      />
                    ) : (
                      <div
                        style={{ height: cellHeight(post) }}
                        className="flex items-center justify-center bg-white/6"
                      >
                        <MapPin size={24} color="rgba(255,255,255,0.4)" />
                      </div>
                    )}
                    {isVideo || isCarousel ? (
                      <span className="absolute top-2 right-2 w-6 h-6 rounded-lg bg-black/50 flex items-center justify-center backdrop-blur-sm">
                        {isVideo ? (
                          <Play size={12} color="#fff" fill="#fff" />
                        ) : (
                          <Grid3x3 size={12} color="#fff" />
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        )}
        <div className="h-10" />
      </div>
    </div>
  );
}

export default LocationDetailScreen;
