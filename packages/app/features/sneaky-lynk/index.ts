/**
 * Sneaky Lynk — public feature surface (WS-6 single-root barrel).
 *
 * Cross-feature / cross-app consumers import ONLY from here
 * (`@dvnt/app/features/sneaky-lynk`) — never a deep path into `api/`, `hooks/`,
 * `stores/`, or `ui/`. Route-bound screens under `screens/` are consumed
 * directly by the app routers (apps/web pages, mobile route files) via their own
 * platform-forked paths and are intentionally NOT re-exported here; test
 * fixtures (`mocks/`) stay feature-private too. The RTC transport lives in
 * `lib/lynk/` (MoQ) — this feature owns no transport of its own.
 *
 * The capture hooks keep their own STOP-THE-LINE / honest-scope docstrings in
 * `hooks/useSneakyLynkCapture{Protection,Broadcast}.ts` — this barrel only
 * re-exports them.
 */

// Types — the feature's shared type contract.
export * from "./types";

// Errors — typed backend-error classification.
export * from "./errors";

// API — Supabase/HTTP query fns + edge-fn wrappers.
export * from "./api/supabase";
export * from "./api/comments";
export * from "./api/room-stats";

// Hooks — TanStack Query + Zustand selectors + capture protection/broadcast.
export * from "./hooks/useRoomEvents";
export * from "./hooks/useRoomReactions";
export * from "./hooks/useRoomCapacityWatcher";
export * from "./hooks/useSneakyLynkCaptureProtection";
export * from "./hooks/useSneakyLynkCaptureBroadcast";

// Stores — Zustand (MMKV-persisted where applicable).
export * from "./stores/room-store";
export * from "./stores/room-ui-store";
export * from "./stores/pin-store";
export * from "./stores/lynk-history-store";
export * from "./stores/create-store";
export * from "./stores/billing-store";

// UI — presentational, feature-private components (existing ui barrel).
export * from "./ui";

// Components — composed containers (paywall / subscription modals).
export * from "./components/SneakyPaywallModal";
export * from "./components/SneakySubscriptionModal";

// WS-6 boundary cleanup — deep-import consumers routed through this barrel.
// Re-exports only (no logic); these ui files were not covered by ./ui.
export { RoomJoinErrorSheet } from "./ui/RoomJoinErrorSheet";
export { RoomFullSheet } from "./ui/RoomFullSheet";
export { CaptureNotificationBanner } from "./ui/CaptureNotificationBanner";
export {
  getSneakyUserLabel,
  normalizeSneakyAnonLabel,
} from "./ui/user-labels";
