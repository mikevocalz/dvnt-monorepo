/**
 * useMasonryLayout
 *
 * Reactive hook that packs SafeGridTile[] into masonry columns.
 *
 * - Derives estimated height per item from kind + deterministic per-post variation
 * - Responsive column count: 2 (phone), 3 (tablet ≥768), 4 (large ≥1024)
 * - Stable: same data + same width = same layout (no reshuffling)
 * - Recalculates only when data or container width meaningfully changes
 */
import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { packColumns } from "./pack-columns";
import type { MasonryItem, MasonryPackResult } from "./types";
import type { SafeGridTile } from "@/lib/utils/safe-profile-mappers";

// ─── Layout constants ────────────────────────────────────────────────────────

const COLUMN_GAP = 3;
const CELL_BORDER_RADIUS = 8;

// ─── Height estimation ───────────────────────────────────────────────────────

/** Base height ratio (relative to column width) by media kind.
 *  Wide spread between kinds + per-post variation → true Pinterest stagger. */
function baseRatioForKind(kind: SafeGridTile["kind"]): number {
  switch (kind) {
    case "video":
      return 1.5; // tall portrait
    case "carousel":
      return 1.0; // square
    case "gif":
      return 0.75; // landscape
    case "livePhoto":
      return 1.3; // slightly tall
    default:
      return 1.2; // image — moderate portrait
  }
}

/**
 * Deterministic hash of post ID → number in [0, 1).
 * Used to add subtle height variation so grids of all-same-kind posts
 * still look like intentional masonry.
 */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 1000) / 1000;
}

/** Variation range: ±30% of base ratio → dramatic Pinterest-style stagger. */
const VARIATION = 0.3;

function estimateItemHeight(item: SafeGridTile, columnWidth: number): number {
  const base = baseRatioForKind(item.kind);
  // Map hash to [-VARIATION, +VARIATION]
  const offset = (hashId(item.id) * 2 - 1) * VARIATION;
  const ratio = base + offset;
  return Math.round(columnWidth * ratio);
}

// ─── Responsive column count ─────────────────────────────────────────────────

function getColumnCount(screenWidth: number): number {
  if (screenWidth >= 1024) return 4;
  if (screenWidth >= 768) return 3;
  return 2;
}

// ─── Masonry tile (extends MasonryItem with tile data) ───────────────────────

export interface MasonryTile extends MasonryItem {
  tile: SafeGridTile;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface MasonryLayoutResult {
  packed: MasonryPackResult<MasonryTile>;
  columnWidth: number;
  columnCount: number;
  columnGap: number;
  cellBorderRadius: number;
}

export function useMasonryLayout(data: SafeGridTile[]): MasonryLayoutResult {
  const { width: screenWidth } = useWindowDimensions();
  const columnCount = getColumnCount(screenWidth);
  const totalGap = COLUMN_GAP * (columnCount + 1);
  const columnWidth = Math.floor((screenWidth - totalGap) / columnCount);

  const packed = useMemo(() => {
    const items: MasonryTile[] = data.map((tile) => ({
      id: tile.id,
      estimatedHeight: estimateItemHeight(tile, columnWidth),
      tile,
    }));
    return packColumns(items, columnCount);
  }, [data, columnWidth, columnCount]);

  return {
    packed,
    columnWidth,
    columnCount,
    columnGap: COLUMN_GAP,
    cellBorderRadius: CELL_BORDER_RADIUS,
  };
}
