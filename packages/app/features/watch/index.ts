// ============================================================
// Watch (Apple Watch sync) feature — public barrel.
// Re-exports only; no logic.
// ============================================================
export { useWatchTicketSync } from "./use-watch-ticket-sync";
export { useWatchBroadcastSync } from "./use-watch-broadcast-sync";
export { useWatchDMSync } from "./use-watch-dm-sync";
export {
  buildDoorEnvelope,
  doorSignature,
  type WatchDoorDTO,
  type WatchDoorEnvelope,
} from "./watch-door-payload";
export { syncDoorToWatch } from "./watch-bridge";
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
