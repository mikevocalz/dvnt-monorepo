/**
 * Auth — public feature surface (WS-6 single-root barrel).
 *
 * Cross-feature / cross-app consumers import ONLY from here
 * (`@dvnt/app/features/auth`) — never a deep path into `ui/`. Re-exports only.
 */
export { AppleButton } from "./ui/apple-button";
