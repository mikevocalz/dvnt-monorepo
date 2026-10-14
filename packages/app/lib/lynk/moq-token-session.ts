/** One room/account's token lifetime. A stopped lifetime can never publish a
 * late result or schedule another refresh, including across A → B → A joins. */
export class MoqTokenRequestError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export interface MoqTokenState<T> {
  token: T | null;
  loading: boolean;
  error: string | null;
}

export function createMoqTokenSession<T extends { expiresAt: string }>(options: {
  fetchToken: (signal: AbortSignal) => Promise<T>;
  onChange: (state: MoqTokenState<T>) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: any) => void;
}) {
  const now = options.now ?? Date.now;
  const schedule: (callback: () => void, delay: number) => unknown =
    options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel: (handle: unknown) => void = options.cancel ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let active = true;
  let timer: unknown = null;
  let expiryTimer: unknown = null;
  let abortRequest: (() => void) | null = null;
  let pending: Promise<T | null> | null = null;
  let failures = 0;
  let state: MoqTokenState<T> = { token: null, loading: false, error: null };

  const emit = (next: MoqTokenState<T>) => {
    state = next;
    if (active) options.onChange(state);
  };
  const clearTimer = () => {
    if (timer != null) cancel(timer);
    timer = null;
  };
  const later = (delay: number) => {
    clearTimer();
    if (active) timer = schedule(() => { void refresh(); }, delay);
  };

  function refresh(): Promise<T | null> {
    if (!active) return Promise.resolve(null);
    if (pending) return pending;
    clearTimer();
    emit({ ...state, loading: true, error: null });
    pending = (async () => {
      const controller = new AbortController();
      let rejectRequest!: (error: Error) => void;
      const aborted = new Promise<never>((_resolve, reject) => { rejectRequest = reject; });
      const abort = () => {
        controller.abort();
        rejectRequest(new MoqTokenRequestError("Media authorization timed out", true));
      };
      abortRequest = abort;
      const timeout = schedule(abort, 8_000);
      try {
        const token = await Promise.race([
          Promise.resolve().then(() => active ? options.fetchToken(controller.signal) : null),
          aborted,
        ]);
        if (!active) return null;
        const expiresAt = token && Date.parse(token.expiresAt);
        if (!token || !expiresAt || !Number.isFinite(expiresAt) || expiresAt <= now()) {
          throw new MoqTokenRequestError("Media authorization has expired", true);
        }
        failures = 0;
        emit({ token, loading: false, error: null });
        if (expiryTimer != null) cancel(expiryTimer);
        // Token refresh and token validity are independent. A hung renewal
        // must never keep publishing/subscribing on an expired grant.
        expiryTimer = schedule(() => {
          expiryTimer = null;
          if (active && state.token === token) {
            emit({ ...state, token: null, error: "Media authorization has expired. Reconnecting…" });
          }
        }, expiresAt - now());
        later(Math.max(15_000, expiresAt - now() - 60_000));
        return token;
      } catch (error) {
        if (!active) return null;
        const retryable = !(error instanceof MoqTokenRequestError) || error.retryable;
        const stillValid = state.token && Date.parse(state.token.expiresAt) > now();
        if ((!retryable || !stillValid) && expiryTimer != null) {
          cancel(expiryTimer);
          expiryTimer = null;
        }
        emit({
          token: retryable && stillValid ? state.token : null,
          loading: false,
          error: error instanceof Error ? error.message : "Token error",
        });
        // A transient cold edge/network failure must not strand the entire
        // room until navigation. Refusals remain terminal until explicit retry.
        if (retryable) later(Math.min(30_000, 1_000 * 2 ** Math.min(failures++, 5)));
        return null;
      } finally {
        cancel(timeout);
        if (abortRequest === abort) abortRequest = null;
        pending = null;
      }
    })();
    return pending;
  }

  return {
    refresh,
    stop() {
      active = false;
      clearTimer();
      if (expiryTimer != null) cancel(expiryTimer);
      expiryTimer = null;
      abortRequest?.();
    },
  };
}
