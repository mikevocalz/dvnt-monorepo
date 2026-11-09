/** Late-bound third-party auth for web and native. No app/store dependency. */
export function createBridgeTransport(anonKey: string) {
  let token: string | null = null;
  let epoch = 0;
  let resolver: (() => Promise<string | null>) | null = null;
  function usable(value: string | null): value is string {
    if (!value) return false;
    try {
      const part = value.split('.')[1];
      const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      return typeof claims.sub === 'string' && !!claims.sub && claims.role === 'authenticated' &&
        typeof claims.exp === 'number' && Number.isFinite(claims.exp) && claims.exp > Date.now() / 1000 + 30;
    } catch { return false; }
  }
  function setToken(next: string | null) {
    if (!next) epoch += 1;
    token = usable(next) ? next : null;
  }
  async function accessToken(): Promise<string> {
    const started = epoch;
    // Do not return token before the account/session resolver runs.
    const current = resolver ? await resolver().catch(() => null) : null;
    return epoch === started && current === token && usable(current) ? current : anonKey;
  }
  function guardFetch(base: typeof fetch): typeof fetch {
    return (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // Edge functions may explicitly use Better Auth tokens. Never rewrite them.
      if (/\/(rest|storage)\/v1(?:\/|$)/.test(url)) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const expectedEpoch = headers.get('x-dvnt-bridge-epoch');
        headers.delete('x-dvnt-bridge-epoch');
        if (expectedEpoch !== null && expectedEpoch !== String(epoch)) {
          return Promise.reject(new Error('Your account changed before this request. Please try again.'));
        }
        const bearer = headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
        // Notifications are private even while a legacy endpoint still has broad
        // grants. Never degrade their reads/writes to the public anon credential.
        // RLS remains the server boundary; this guard makes mint failures visible
        // and prevents the current client from silently using the legacy rail.
        if (/\/rest\/v1\/notifications(?:[/?#]|$)/.test(url) &&
          (!bearer || bearer === anonKey || bearer !== token || !usable(bearer))) {
          return Promise.reject(new Error('Your private activity could not be verified. Please sign in again or retry.'));
        }
        // Final synchronous gate after supabase-js's async token selection and
        // immediately before dispatch. Never replace an old request's A with B.
        if (bearer && bearer !== anonKey && (bearer !== token || !usable(bearer))) {
          return Promise.reject(new Error('Your account changed before this request. Please try again.'));
        }
        return base(input, { ...init, headers });
      }
      return base(input, init);
    };
  }
  return { setToken, accessToken, guardFetch, requestEpoch: () => String(epoch), setMinter(next: (() => Promise<string | null>) | null) { resolver = next; } };
}
