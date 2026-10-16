import { hostStageLayout, type HostStageLayout } from "./stage-layout.ts";

const OUTER_PADDING = 12;
const GAP = 8;
export const NATIVE_CROWD_HEADER_HEIGHT = 32;
const MIN_CROWD_TILE_HEIGHT = 96;

export interface NativeRoomStageLayout {
  sideBySide: boolean;
  duo: boolean;
  hostRegionWidth: number;
  hostRegionHeight: number;
  host: HostStageLayout;
  crowdRegionWidth: number;
  crowdRegionHeight: number;
  crowdViewportHeight: number;
  crowdColumns: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
}

/**
 * Work only with the stage space left AFTER the header and controls. A short
 * landscape stage puts the focus beside the crowd, preserving useful faces
 * instead of squeezing two rows underneath a screen-height-sized hero.
 */
export function nativeRoomStageLayout(
  width: number,
  height: number,
  hostCount: number,
  attendeeCount: number,
): NativeRoomStageLayout {
  const safeWidth = Math.max(0, Number.isFinite(width) ? width : 0);
  const safeHeight = Math.max(0, Number.isFinite(height) ? height : 0);
  const gap = Math.min(GAP, safeWidth, safeHeight);
  const hasCrowd = attendeeCount > 0;
  const duo = hostCount === 1 && attendeeCount === 1;
  if (duo) {
    const sideBySide = safeWidth > safeHeight * 1.2;
    const regionWidth = sideBySide ? Math.max(0, (safeWidth - gap) / 2) : safeWidth;
    const maxHeight = sideBySide ? safeHeight : Math.max(0, Math.floor((safeHeight - gap) / 2));
    const host = hostStageLayout(1, Math.max(0, regionWidth - OUTER_PADDING * 2), maxHeight, "native");
    return {
      duo,
      sideBySide,
      hostRegionWidth: regionWidth,
      hostRegionHeight: host.stage.height,
      host,
      crowdRegionWidth: regionWidth,
      crowdRegionHeight: host.stage.height,
      crowdViewportHeight: host.stage.height,
      crowdColumns: 1,
      tileWidth: host.stage.width,
      tileHeight: host.stage.height,
      gap,
    };
  }
  const sideBySide = hasCrowd && safeHeight < 300 && safeWidth > safeHeight * 1.2;
  const hostRegionWidth = sideBySide ? Math.max(0, Math.floor((safeWidth - gap) * 0.44)) : safeWidth;
  const hostRegionHeight = sideBySide
    ? safeHeight
    : Math.max(0, Math.min(
        Math.round(safeHeight * (hasCrowd ? 0.44 : 0.65)),
        hasCrowd ? safeHeight - gap - NATIVE_CROWD_HEADER_HEIGHT - MIN_CROWD_TILE_HEIGHT : safeHeight,
      ));
  const host = hostStageLayout(
    hostCount,
    Math.max(0, hostRegionWidth - OUTER_PADDING * 2),
    hostRegionHeight,
    "native",
  );
  // Use actual aspect-constrained hero height, never reserve a phantom block.
  const resolvedHostHeight = sideBySide ? safeHeight : host.stage.height;
  const crowdRegionWidth = sideBySide ? Math.max(0, safeWidth - hostRegionWidth - gap) : safeWidth;
  const crowdRegionHeight = sideBySide ? safeHeight : Math.max(0, safeHeight - resolvedHostHeight - gap);
  const crowdViewportHeight = Math.max(0, crowdRegionHeight - NATIVE_CROWD_HEADER_HEIGHT);
  const contentWidth = Math.max(0, crowdRegionWidth - OUTER_PADDING * 2);
  const crowdColumns = Math.max(1, Math.min(4, Math.floor((contentWidth + gap) / (136 + gap))));
  const tileWidth = Math.max(0, Math.floor((contentWidth - gap * (crowdColumns - 1)) / crowdColumns));
  const tileHeight = Math.max(0, Math.min(
    180,
    Math.max(MIN_CROWD_TILE_HEIGHT, Math.round(tileWidth * 0.75)),
    Math.max(0, crowdViewportHeight - gap),
  ));
  return {
    duo,
    sideBySide,
    hostRegionWidth,
    hostRegionHeight: resolvedHostHeight,
    host,
    crowdRegionWidth,
    crowdRegionHeight,
    crowdViewportHeight,
    crowdColumns,
    tileWidth,
    tileHeight,
    gap,
  };
}
