// ============================================================
// Watch (Apple Watch sync) feature — public barrel.
// Re-exports only; no logic.
// ============================================================
export { useWatchTicketSync } from "./use-watch-ticket-sync";
export { useWatchBroadcastSync } from "./use-watch-broadcast-sync";
export {
  getWatchStatus,
  setWatchFeature,
  type WatchStatus,
} from "./watch-bridge";
export {
  useWatchSettingsStore,
  watchFeatureEnabled,
  type WatchFeatureKey,
  type WatchFeatures,
} from "./watch-settings-store";
