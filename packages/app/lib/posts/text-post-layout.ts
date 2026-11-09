/** Fit text to narrow cards while letting full feed/detail content grow vertically. */
export function fitTextPostFontSize(text: string, availableWidth: number, preferred: number): number {
  if (availableWidth <= 0) return preferred;
  const widthLimit = availableWidth / 9;
  const densityLimit = text.length > 700 ? 18 : text.length > 300 ? 22 : preferred;
  return Math.max(12, Math.min(preferred, widthLimit, densityLimit));
}
