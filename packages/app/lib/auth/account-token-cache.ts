/** Account-scoped session tokens. No platform dependencies so races can be tested. */
export interface TokenIdentity {
  id: string;
  authId?: string;
  email?: string;
}

interface SessionResult {
  data?: {
    user?: { id?: string; email?: string };
    session?: { token?: string; expiresAt?: string | Date };
  } | null;
  error?: unknown;
}

export function createAccountTokenCache(options: {
  getIdentity: () => TokenIdentity | null;
  getSession: () => Promise<SessionResult>;
  onError?: (error: unknown) => void;
  retryDelayMs?: number;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let epoch = 0;
  let owner: string | undefined;
  let flight: Promise<string | null> | null = null;
  let cached: { token: string; until: number } | null = null;
  let mutations = 0;
  let latestMutation = 0;
  let signedOut = false;
  let signOutConfirmed = false;
  let lastSessionToken: string | null = null;
  let signedOutSessionToken: string | null = null;
  let loginIdentity: TokenIdentity | null = null;

  function invalidate() {
    epoch += 1;
    cached = null;
    // Old requests keep their own promise, but cannot satisfy the new account.
    flight = null;
  }

  function observeIdentity() {
    const identity = options.getIdentity();
    const next = JSON.stringify([
      identity?.id ?? null,
      identity?.authId ?? null,
      identity?.email?.toLowerCase() ?? null,
    ]);
    if (next !== owner) {
      owner = next;
      loginIdentity = null;
      invalidate();
    }
    return identity;
  }

  function matchesIdentity(result: SessionResult, identity: TokenIdentity | null) {
    const user = result.data?.user;
    if (!user?.id) return false;
    if (!identity) return true; // First login: the app profile is not loaded yet.
    const authId = identity.authId || (!/^\d+$/.test(identity.id) ? identity.id : null);
    if (authId) return user.id === authId;
    // Some existing login paths store only the integer app ID + email.
    return Boolean(identity.email && user.email && identity.email.toLowerCase() === user.email.toLowerCase());
  }

  async function getToken(): Promise<string | null> {
    const identity = observeIdentity();
    if (mutations > 0 || signedOut) return null;
    if (cached && now() < cached.until) return cached.token;
    if (flight) return flight;

    const requestEpoch = epoch;
    const expectedIdentity = loginIdentity ?? identity;
    const isCurrent = () => {
      observeIdentity();
      return requestEpoch === epoch && mutations === 0 && !signedOut;
    };

    const request = (async () => {
      const attempts = options.retryDelayMs === undefined ? 1 : 2;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (!isCurrent()) return null;
        let result: SessionResult;
        try {
          result = await options.getSession();
        } catch (error) {
          result = { error };
        }
        if (!isCurrent()) return null;
        if (result.error) {
          options.onError?.(result.error);
          if (attempt + 1 < attempts) {
            await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs));
            continue;
          }
          return null;
        }
        const token = result.data?.session?.token;
        if (!token || !matchesIdentity(result, expectedIdentity)) return null;
        const expiresAt = result.data?.session?.expiresAt;
        const expires = expiresAt ? new Date(expiresAt).getTime() - 30_000 : Infinity;
        cached = { token, until: Math.min(now() + 4 * 60_000, Number.isFinite(expires) ? expires : Infinity) };
        if (cached.until <= now()) {
          cached = null;
          return null;
        }
        lastSessionToken = token;
        return token;
      }
      return null;
    })();
    flight = request;
    try {
      return await request;
    } finally {
      // A stale request finishing must not erase a newer account's flight.
      if (flight === request) flight = null;
    }
  }

  /** Called only by a successful external OAuth/magic-link callback. */
  async function resumeSession(): Promise<boolean> {
    observeIdentity();
    if (mutations > 0) return false;
    const requestEpoch = epoch;
    let result: SessionResult;
    try {
      result = await options.getSession();
    } catch (error) {
      options.onError?.(error);
      return false;
    }
    observeIdentity();
    if (epoch !== requestEpoch || mutations > 0 || result.error) return false;
    const user = result.data?.user;
    const session = result.data?.session;
    if (!user?.id || !session?.token) return false;
    const expires = session.expiresAt ? new Date(session.expiresAt).getTime() : Infinity;
    if (Number.isFinite(expires) && expires <= now()) return false;
    // A failed sign-out can leave its cookie alive. A callback must prove a
    // different server session before that local sign-out lock is released.
    if (signedOut && !signOutConfirmed && (!signedOutSessionToken || session.token === signedOutSessionToken)) return false;
    invalidate();
    loginIdentity = { id: user.id, authId: user.id, email: user.email };
    lastSessionToken = session.token;
    signedOut = false;
    return true;
  }

  async function mutate<T>(kind: "signIn" | "signUp" | "signOut", run: () => Promise<T>): Promise<T> {
    observeIdentity();
    const mutation = ++latestMutation;
    mutations += 1;
    invalidate();
    if (kind === "signOut") {
      signedOut = true;
      signOutConfirmed = false;
      signedOutSessionToken = lastSessionToken;
      loginIdentity = null;
    }
    try {
      const result = await run();
      const response = result as { data?: { user?: { id?: string; email?: string }; token?: string; session?: { token?: string } }; error?: unknown };
      if (mutation === latestMutation && kind === "signOut" && !response?.error) {
        signOutConfirmed = true;
      }
      // A successful sign-in is authoritative while syncAuthUser loads the
      // app profile. The persisted UI may still contain the previous account.
      if (mutation === latestMutation && kind !== "signOut" && !response?.error && response?.data?.user?.id) {
        observeIdentity();
        loginIdentity = { id: response.data.user.id, authId: response.data.user.id, email: response.data.user.email };
        lastSessionToken = response.data.session?.token ?? response.data.token ?? lastSessionToken;
        signedOut = false;
      }
      return result;
    } finally {
      mutations -= 1;
      invalidate();
    }
  }

  return { getToken, invalidate, observeIdentity, mutate, resumeSession };
}

/** Preserve Better Auth's inferred methods, including nested signIn.social. */
export function withAccountTokenInvalidation<T extends object>(
  client: T,
  cache: ReturnType<typeof createAccountTokenCache>,
): T {
  const wrapped = new Map<PropertyKey, unknown>();
  const wrapOperation = (target: object, kind: "signIn" | "signUp" | "signOut"): object => new Proxy(target, {
    get(inner, key, receiver) {
      const value = Reflect.get(inner, key, receiver);
      return typeof value === "function" ? wrapOperation(value, kind) : value;
    },
    apply(target, thisArg, args) {
      return cache.mutate(kind, () => Promise.resolve(Reflect.apply(target as (...args: unknown[]) => unknown, thisArg, args)));
    },
  });
  return new Proxy(client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key !== "signIn" && key !== "signUp" && key !== "signOut") return value;
      if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
      if (!wrapped.has(key)) wrapped.set(key, wrapOperation(value, key));
      return wrapped.get(key);
    },
  });
}
