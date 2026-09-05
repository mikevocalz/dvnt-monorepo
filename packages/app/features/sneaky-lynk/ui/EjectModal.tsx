/**
 * EjectModal — shown when a session ends without the user choosing it.
 *
 * Modal on BOTH platforms, deliberately. Web's version was named EjectBanner
 * but was already a full-screen blocking overlay requiring acknowledgement, so
 * the behaviours never actually differed — only the name and the copy did.
 * Being removed from a room is involuntary and terminal for that session; a
 * surface the user can miss reads as the app breaking.
 *
 * This base file is the TypeScript resolution target + the prop contract; the
 * platform files provide the real rendering.
 */

export type { EjectKind, EjectModalProps } from "./EjectModal.types";
export { EJECT_COPY } from "./EjectModal.types";
import type { EjectModalProps } from "./EjectModal.types";

/**
 * Base implementation is intentionally inert — Metro/web always resolve a
 * platform file.
 */
export function EjectModal(_props: EjectModalProps): null {
  return null;
}
