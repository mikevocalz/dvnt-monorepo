/** Memory-only bridge credentials, bound to the verified Better Auth session.
 * A bridge JWT is never restored independently of the session that minted it.
 */
export interface BridgeJwt { accessToken: string; expiresAt: number; subject: string }
export function bridgeClaims(token: string): { subject: string; expiresAt: number } | null {
  try {
    const encoded = token.split('.')[1];
    const claims = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.sub === 'string' && claims.sub.length > 0 &&
      claims.role === 'authenticated' && typeof claims.exp === 'number' && Number.isFinite(claims.exp)
      ? { subject: claims.sub, expiresAt: claims.exp } : null;
  } catch { return null; }
}
export function createAccountBridgeCache(options: {
  getSessionToken: () => Promise<string | null>;
  mint: (sessionToken: string) => Promise<BridgeJwt | null>;
  onToken: (token: string | null) => void;
  now?: () => number;
}) {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  let epoch = 0;
  let cached: { sessionToken: string; jwt: BridgeJwt } | null = null;
  let flight: { epoch: number; sessionToken: string; promise: Promise<BridgeJwt | null> } | null = null;
  function invalidate() {
    epoch += 1;
    cached = null;
    flight = null;
    options.onToken(null); // synchronous: detach BEFORE any async cleanup
  }
  async function get(): Promise<BridgeJwt | null> {
    const requestEpoch = epoch;
    const token = await options.getSessionToken().catch(() => null);
    if (requestEpoch !== epoch) return null;
    if (!token) { invalidate(); return null; }
    if (cached?.sessionToken === token && cached.jwt.expiresAt - now() > 600) return cached.jwt;
    if (cached && cached.sessionToken !== token) { cached = null; options.onToken(null); }
    if (flight?.epoch === requestEpoch && flight.sessionToken === token) return flight.promise;
    const request = { epoch: requestEpoch, sessionToken: token, promise: Promise.resolve<BridgeJwt | null>(null) };
    request.promise = (async () => {
      const jwt = await options.mint(token).catch(() => null);
      // A/B/A, logout, failed sign-out and late failures all invalidate this flight.
      if (epoch !== requestEpoch || flight !== request) return null;
      const claims = jwt && bridgeClaims(jwt.accessToken);
      if (!jwt || !claims || claims.subject !== jwt.subject || claims.expiresAt !== jwt.expiresAt || jwt.expiresAt - now() <= 30) {
        cached = null; options.onToken(null); return null;
      }
      cached = { sessionToken: token, jwt };
      options.onToken(jwt.accessToken);
      return jwt;
    })();
    flight = request;
    try { return await request.promise; }
    finally { if (flight === request) flight = null; }
  }
  return { get, invalidate, epoch: () => epoch };
}
