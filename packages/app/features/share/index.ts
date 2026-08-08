/**
 * Share — public feature surface (WS-6 single-root barrel).
 *
 * Cross-feature / cross-app consumers import ONLY from here
 * (`@dvnt/app/features/share`) — never a deep path into `ui/`. Re-exports only.
 */
export { SpotifyShareSheet } from "./ui/spotify-share-sheet";
