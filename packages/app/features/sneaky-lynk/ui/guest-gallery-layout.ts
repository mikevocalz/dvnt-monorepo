/** Web room geometry for a host above swipeable pages of guests. */
const GAP = 8;
const MAX_WIDTH = 768;
const MAX_ASPECT = 16 / 9;
const PAGE_FOOTER = 44;

export interface RoomGalleryLayout {
  width: number;
  host: { width: number; height: number };
  guestTop: number;
  guestHeight: number;
  columns: number;
  rows: number;
  pageSize: number;
  pageCount: number;
  tileWidth: number;
  tileHeight: number;
  contentHeight: number;
  footerHeight: number;
  gap: number;
}

/** Height is the measured stage space, after the room header and control dock. */
export function roomGalleryLayout(
  availableWidth: number,
  availableHeight: number,
  guestCount: number,
): RoomGalleryLayout {
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const width = Math.min(MAX_WIDTH, finite(availableWidth));
  const height = finite(availableHeight);
  const count = finite(guestCount);
  const footerHeight = count > 1 ? Math.min(PAGE_FOOTER, height) : 0;
  const contentHeight = Math.max(0, height - footerHeight);
  const gap = count > 0 ? Math.min(GAP, contentHeight) : 0;
  const hostHeight = count > 0 ? Math.floor((contentHeight - gap) / 2) : contentHeight;
  const host = { width: Math.min(width, Math.floor(hostHeight * MAX_ASPECT)), height: hostHeight };
  const guestHeight = count > 0 ? Math.max(0, contentHeight - hostHeight - gap) : 0;
  const columns = count > 1 && width >= 288 ? 2 : 1;
  const rows = count > columns && guestHeight >= 200 ? 2 : 1;
  const pageSize = columns * rows;
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const tileHeight = Math.max(0, Math.floor((guestHeight - gap * (rows - 1)) / rows));
  const tileWidth = count === 1
    ? host.width
    : Math.max(0, Math.floor((width - gap * (columns - 1)) / columns));
  return {
    width, host, guestTop: hostHeight + gap, guestHeight, columns, rows,
    pageSize, pageCount, tileWidth, tileHeight, contentHeight, footerHeight, gap,
  };
}

/** Flat positioning keeps each participant under one stable keyed parent. */
export function guestGalleryPosition(index: number, layout: RoomGalleryLayout) {
  const page = Math.floor(index / layout.pageSize);
  const slot = index % layout.pageSize;
  const column = slot % layout.columns;
  const row = Math.floor(slot / layout.columns);
  const inset = layout.columns === 1 ? (layout.width - layout.tileWidth) / 2 : 0;
  return {
    page,
    left: page * layout.width + inset + column * (layout.tileWidth + layout.gap),
    top: row * (layout.tileHeight + layout.gap),
  };
}

/** A departed final page must never leave the viewer on an empty screen. */
export function clampGalleryPage(page: number, pageCount: number): number {
  return Math.max(0, Math.min(Math.floor(page), Math.max(0, pageCount - 1)));
}
