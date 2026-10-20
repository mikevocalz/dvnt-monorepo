/** Web stage modes and fallback grid classes. The live room uses the measured
 * host-over-paged-guests geometry in guest-gallery-layout.ts. Two-person web
 * calls always stack, including desktop; native layout is independent. */
/** Whether the participant stage is a solo, one-to-one, or group call. */
export function stageMode(count: number): "solo" | "duo" | "group" {
  if (count <= 1) return "solo";
  if (count === 2) return "duo";
  return "group";
}

export function stageGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1";
  if (count <= 4) return "grid-cols-2";
  if (count <= 9) return "grid-cols-2 sm:grid-cols-3";
  return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
}

/** Columns the class above resolves to at a given viewport width. */
export function stageColumns(count: number, width: number): number {
  const sm = width >= 640;
  const md = width >= 768;
  if (count <= 1) return 1;
  if (count === 2) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return sm ? 3 : 2;
  return md ? 4 : sm ? 3 : 2;
}
