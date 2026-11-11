/** Dependency-free bridge used at the synchronous relationship reset boundary. */
const listeners = new Set<() => void>();
export function retirePostMediaLeases() { for (const fn of listeners) fn(); }
export function onPostMediaLeaseRetirement(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
