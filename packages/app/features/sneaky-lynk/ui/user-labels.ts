/**
 * Re-export shim. The anonymity-safe label rule moved to lib/user-label so the
 * calls rail can use it too — features/video had the same ungated fallback
 * chain that leaked real names on web, and importing a helper across a feature
 * boundary to fix it would have traded one problem for another.
 *
 * Kept so the existing Sneaky Lynk call sites need no churn.
 */
export {
  getSneakyUserLabel,
  getSneakyUserHandle,
  getSneakyUserShortLabel,
  normalizeSneakyAnonLabel,
// Relative with an explicit extension: hand-queue.ts is exercised by
// `node --test`, whose resolver understands neither the @dvnt/app alias nor an
// extensionless TS specifier. See the note in hand-queue.ts.
} from "../../../lib/user-label.ts";
