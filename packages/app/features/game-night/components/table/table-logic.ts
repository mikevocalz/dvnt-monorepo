import type { TableMember, TableReveal } from "./types";

export interface SeatPosition extends TableMember {
  x: number;
  y: number;
}

/** Stable ellipse layout. Seat numbers, not presence arrival order, own positions. */
export function layoutSeats(
  members: TableMember[],
  width: number,
  height: number,
): SeatPosition[] {
  const ordered = [...members].sort(
    (a, b) => a.seat_no - b.seat_no || a.user_id.localeCompare(b.user_id),
  );
  const count = Math.max(ordered.length, 1);
  return ordered.map((member, index) => {
    const angle = Math.PI / 2 + (index / count) * Math.PI * 2;
    return {
      ...member,
      x: width / 2 + Math.cos(angle) * width * 0.4,
      y: height / 2 + Math.sin(angle) * height * 0.38,
    };
  });
}

/** Winners are emphasized first while preserving server order within each group. */
export function orderReveal(reveal: TableReveal[] | null): TableReveal[] {
  if (!reveal) return [];
  return reveal
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Number(!!b.entry.is_winner) - Number(!!a.entry.is_winner) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

/** Toggle without allowing more cards than the prompt requests. */
export function toggleSelection(
  selected: string[],
  cardId: string,
  pick: number,
): string[] {
  if (selected.includes(cardId)) return selected.filter((id) => id !== cardId);
  if (selected.length >= Math.max(0, pick)) return selected;
  return [...selected, cardId];
}
/** A physical card drag only commits when it is intentional and moves toward the table. */
export function isCommitDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  minDistance = 28,
  minUpward = 18,
): boolean {
  const dx = endX - startX;
  const dy = endY - startY;
  return Math.hypot(dx, dy) >= minDistance && dy <= -minUpward;
}
