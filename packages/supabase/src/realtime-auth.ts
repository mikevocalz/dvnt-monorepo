/** Await explicit socket authentication before opening private subscriptions.
 * No token is returned to callers or logged. A failed refresh never opens anon.
 */
export function createRealtimeAuthController(options: {
  accessToken: () => Promise<string>;
  requestEpoch: () => string;
  anonKey: string;
  setAuth: (token: string) => Promise<void>;
}) {
  let pending = Promise.resolve();
  let revision = 0;
  let appliedRevision = 0;
  let appliedToken: string | null = null;
  // Every explicit socket credential update (including logout) shares this
  // queue. A slow A completion can never be the last write after queued B/anon.
  function updateAuth(token: string): Promise<void> {
    const ownRevision = ++revision;
    const task = pending.catch(() => {}).then(async () => {
      if (ownRevision !== revision) return;
      await options.setAuth(token);
      appliedToken = token;
      appliedRevision = ownRevision;
    });
    pending = task;
    return task;
  }
  async function ensureBridgeRealtimeAuth(): Promise<boolean> {
    const epoch = options.requestEpoch();
    try {
      const token = await options.accessToken();
      if (!token || token === options.anonKey || epoch !== options.requestEpoch()) return false;
      // Explicit token avoids a second asynchronous SDK resolver racing sign-out.
      await updateAuth(token);
      if (epoch !== options.requestEpoch()) return false;
      const current = await options.accessToken();
      // Another caller may have superseded our queued update with the same
      // token. Await that last update too; skipping a task is not readiness.
      await pending;
      return current === token && appliedToken === token &&
        appliedRevision === revision && epoch === options.requestEpoch();
    } catch {
      return false;
    }
  }
  return { updateAuth, ensureBridgeRealtimeAuth };
}
