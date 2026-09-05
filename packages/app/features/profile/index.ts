/**
 * Profile — public feature surface (WS-6 single-root barrel).
 *
 * Cross-feature / cross-app consumers import ONLY from here
 * (`@dvnt/app/features/profile`) — never a deep path into `ui/`. Re-exports only.
 */
export { ProfileMasonryGrid } from "./ui/ProfileMasonryGrid";
export { ProfileScreenGuard } from "./ui/ProfileScreenGuard";
export { ProfilePronounsPill } from "./ui/ProfilePronounsPill";
