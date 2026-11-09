/** A refreshed grant authorizes the ongoing session; it is not an instruction
 * to redial a healthy wire. @moq/net reconnects whenever its URL changes.
 * Keep the newest credentials ready for an actual reconnect without changing
 * the server's short grant lifetime or its repeated admission checks. */
export interface RelayGrant {
  relayUrl: string;
  expiresAt: string;
  intent?: string;
  fishjamId?: string;
  namespace?: string;
  path?: string;
  peerId?: string;
  role?: string;
}

interface Readable<T> {
  peek(): T;
  subscribe(callback: () => void): () => void;
}

export function createRelayAuthorization(options: {
  status: Readable<string>;
  error: Readable<unknown>;
  setUrl: (url: URL | undefined) => void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let active = true;
  let grant: RelayGrant | null = null;
  let owner = "";
  let installedScope: string | null = null;
  let installedUrl: string | undefined;
  let refusedUrl: string | undefined;

  const set = (url: string | undefined, scope: string | null) => {
    // Set our state first: signal subscribers can run synchronously in tests.
    installedScope = scope;
    if (installedUrl === url) return;
    installedUrl = url;
    options.setUrl(url ? new URL(url) : undefined);
  };
  const sync = () => {
    if (!active) return;
    const expiry = grant ? Date.parse(grant.expiresAt) : NaN;
    if (!grant || !Number.isFinite(expiry) || expiry <= now()) {
      set(undefined, null);
      return;
    }
    let endpoint: URL;
    try { endpoint = new URL(grant.relayUrl); }
    catch { set(undefined, null); return; }
    // Only the provider's documented JWT parameter rotates. A different host,
    // port, path or other option is a different relay and must take effect.
    endpoint.searchParams.delete("jwt");
    const scope = JSON.stringify([owner, endpoint.href, grant.intent,
      grant.fishjamId, grant.namespace, grant.path, grant.peerId, grant.role]);
    // A changed authority must never simply relabel an existing wire. If a
    // caller reuses the exact credential for another scope, fail closed until
    // a genuinely fresh credential arrives (including across status callbacks).
    if (installedScope && scope !== installedScope && grant.relayUrl === installedUrl) {
      refusedUrl = grant.relayUrl;
    }
    if (grant.relayUrl === refusedUrl) {
      set(undefined, null);
      return;
    }
    const healthy = options.status.peek() === "connected" && !options.error.peek();
    if (!installedUrl || scope !== installedScope || !healthy) {
      set(grant.relayUrl, scope);
    }
  };
  const stopStatus = options.status.subscribe(sync);
  const stopError = options.error.subscribe(sync);
  return {
    authorize(next: RelayGrant | null, authorizationScope: string) {
      grant = next;
      owner = authorizationScope;
      sync();
    },
    close() {
      active = false;
      stopStatus();
      stopError();
      grant = null;
      set(undefined, null);
    },
  };
}
