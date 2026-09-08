import { create } from "zustand";

/**
 * Measured width of a grid's container, keyed by grid id.
 *
 * Grids here have repeatedly been sized off `useWindowDimensions` while living
 * inside a capped content column, which makes cells wider than the box holding
 * them. onLayout reports the real box; this is where that measurement lives.
 *
 * Zustand rather than `useState`: house rule.
 */
interface GridMeasureState {
  widthById: Record<string, number>;
  setWidth: (id: string, width: number) => void;
}

export const useGridMeasureStore = create<GridMeasureState>((set) => ({
  widthById: {},
  setWidth: (id, width) =>
    set((s) =>
      // Ignore sub-pixel jitter; a store write per fractional change is waste.
      Math.abs((s.widthById[id] ?? 0) - width) <= 1
        ? s
        : { widthById: { ...s.widthById, [id]: width } },
    ),
}));
