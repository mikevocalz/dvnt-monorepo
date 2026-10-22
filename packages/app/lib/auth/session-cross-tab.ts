/** Signals contain no identity or credentials. Another tab can only invalidate. */
export const SESSION_BOUNDARY_KEY = 'dvnt-session-boundary-v1';
export function installSessionCrossTab(options: {
  target: Window;
  subscribe: (listener: () => void) => () => void;
  invalidate: () => void;
  revalidate: () => void;
}) {
  let receiving = false;
  let sequence = 0;
  const reconcile = () => {
    receiving = true;
    try { options.invalidate(); } finally { receiving = false; }
  };
  const unsubscribe = options.subscribe(() => {
    if (receiving) return;
    try { options.target.localStorage.setItem(SESSION_BOUNDARY_KEY, `${Date.now()}:${++sequence}:${Math.random()}`); } catch { /* private mode */ }
  });
  const storage = (event: StorageEvent) => {
    if (event.key === SESSION_BOUNDARY_KEY || event.key === null) reconcile();
  };
  const focus = () => options.revalidate();
  const visibility = () => { if (options.target.document.visibilityState === 'visible') focus(); };
  options.target.addEventListener('storage', storage);
  options.target.addEventListener('focus', focus);
  options.target.document.addEventListener('visibilitychange', visibility);
  return () => {
    unsubscribe();
    options.target.removeEventListener('storage', storage);
    options.target.removeEventListener('focus', focus);
    options.target.document.removeEventListener('visibilitychange', visibility);
  };
}
