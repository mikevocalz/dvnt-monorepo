/** Dock geometry is width-driven and never trades away a 44pt touch target. */
export function controlsLayout(width: number, leftInset: number, rightInset: number, count: number) {
  const sidePadding = 8;
  const glassPadding = 8;
  const available = Math.max(0, width - leftInset - rightInset - sidePadding * 2 - glassPadding * 2 - 2);
  const gap = 6;
  const size = Math.max(44, Math.min(52, Math.floor((available - gap * (count - 1)) / count)));
  return { size, gap, sidePadding, glassPadding };
}
