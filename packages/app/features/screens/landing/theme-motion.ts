/**
 * Reanimated motion tokens — NATIVE-ONLY import.
 *
 * Split out of theme.ts so the landing's web forks can import the brand tokens
 * without pulling react-native-reanimated into the web bundle: the public `/`
 * route must never execute Reanimated (its web `_updatePropsJS` crashes when a
 * mapper fires against a detached view descriptor — the DVNT-WEB-6 flood).
 * Web files use EASE_SETTLE_CSS from theme.ts instead.
 */
import { Easing } from "react-native-reanimated";

/**
 * Signature easing — the cinematic "settle" curve used across the page
 * (header glass, section entrances). Matches the spec's bezier(0.22,1,0.36,1).
 */
export const EASE_SETTLE = Easing.bezier(0.22, 1, 0.36, 1);
