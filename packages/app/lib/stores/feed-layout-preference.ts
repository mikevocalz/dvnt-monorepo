export type FeedMode = "classic" | "masonry";

/** Missing/corrupt settings use the default; an explicit list choice is never reset. */
export function readFeedMode(value: unknown): FeedMode {
  return value === "classic" || value === "masonry" ? value : "masonry";
}

export function feedColumnCount(mode: FeedMode, width: number): number {
  if (mode === "classic") return 1;
  return width >= 1000 ? 4 : width >= 680 ? 3 : 2;
}
