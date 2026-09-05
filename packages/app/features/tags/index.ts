/**
 * Tags — public feature surface (WS-6 single-root barrel).
 *
 * Cross-feature / cross-app consumers import ONLY from here
 * (`@dvnt/app/features/tags`) — never a deep path into `ui/`. Re-exports only.
 */
export { TagOverlayViewer } from "./ui/TagOverlayViewer";
export { TagPeopleSheet } from "./ui/TagPeopleSheet";
export type { TagCandidate } from "./ui/TagPeopleSheet";
