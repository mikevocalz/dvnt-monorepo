// WS-6 structure migration — PR 5 (events merge). Public surface of the merged
// `events` feature: types + promotion-types + the (native/shared) `ui` bucket.
// Cross-feature consumers import `@dvnt/app/features/events`; intra-feature code
// keeps using relative / deep paths. ZERO logic — barrel only.
export * from "./types";
export * from "./promotion-types";
export * from "./ui";
