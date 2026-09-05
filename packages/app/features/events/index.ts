// WS-6 structure migration — PR 5 (events merge). Public surface of the merged
// `events` feature: types + promotion-types + the (native/shared) `ui` bucket.
// Cross-feature consumers import `@dvnt/app/features/events`; intra-feature code
// keeps using relative / deep paths. ZERO logic — barrel only.
export * from "./types";
export * from "./promotion-types";
export * from "./ui";

// WS-6 boundary cleanup — deep-import consumers routed through this barrel.
// Re-exports only (no logic). weather-strip is platform-forked (.tsx/.web.tsx);
// the extensionless re-export preserves .web/.native resolution at the bundler.
export { EventCollectionRow } from "./ui/event-collection-row";
export { EventsMapSheet } from "./ui/events-map-sheet";
export { EventFilterSheet } from "./ui/event-filter-sheet";
export { SpotlightSection } from "./ui/spotlight-carousel";
export { PromoteEventSheet } from "./ui/promote-event-sheet";
export { BroadcastModal } from "./ui/broadcast-modal";
export { CompTicketsModal } from "./ui/comp-tickets-modal";
export { RefundConfirmModal } from "./ui/refund-confirm-modal";
export { EventActionSheet } from "./ui/event-action-sheet";
export { HostEventsPickerSheet } from "./ui/host-events-picker-sheet";
export { hostEventsHref, resolveHosts, needsHostPicker } from "./ui/host-events-route";
export { EventEditSheet } from "./ui/event-edit-sheet";
export { ShareEventSheet } from "./ui/share-event-sheet";
export { UpgradeTierCard } from "./ui/UpgradeTierCard";
export { UpgradeConfirmationSheet } from "./ui/UpgradeConfirmationSheet";
export { WeatherStrip } from "./ui/weather-strip";
export { GuestCheckoutSheet } from "./ui/GuestCheckoutSheet";
export { FilterPills } from "./ui/filter-pills";
export type { EventFilter } from "./ui/filter-pills";
