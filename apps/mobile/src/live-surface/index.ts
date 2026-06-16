/**
 * DVNT Live Surface — barrel export.
 *
 * Usage:
 *   import { useLiveSurface, fetchLiveSurface, updateLiveActivity } from '@/src/live-surface';
 */
export { fetchLiveSurface } from "./api";
export { useLiveSurface } from "./hooks/use-live-surface";
export {
  areLiveActivitiesEnabled,
  endLiveActivity,
  updateLiveActivity,
} from "./native/ios-bridge";
export type {
  LiveActivityState,
  LiveSurfacePayload,
  LiveSurfaceTile1,
  LiveSurfaceTile3,
  LiveSurfaceTile3Item,
  LiveSurfaceWeather,
} from "./types";
