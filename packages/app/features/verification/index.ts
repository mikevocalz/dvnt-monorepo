/**
 * Verification — public feature surface (WS-6 single-root barrel).
 *
 * Cross-feature / cross-app consumers import ONLY from here
 * (`@dvnt/app/features/verification`) — never a deep path into `ui/`. Re-exports only.
 */
export { IdScanTab, FaceScanTab } from "./ui/tabs";
