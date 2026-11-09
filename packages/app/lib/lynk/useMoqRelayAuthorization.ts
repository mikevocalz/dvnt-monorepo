import { useEffect, useRef } from "react";
import type * as Moq from "@moq/net";
import type { Signal } from "@moq/signals";
import { createRelayAuthorization, type RelayGrant } from "./moq-relay-authorization";

/** Observe SDK status directly so a real drop uses the latest grant before
 * the SDK's retry, rather than waiting for React to render a connection state. */
export function useMoqRelayAuthorization(
  connection: Moq.Connection | null,
  url: Signal<URL | undefined>,
  grant: RelayGrant | null,
  authorizationScope: string,
) {
  const authorization = useRef<ReturnType<typeof createRelayAuthorization> | null>(null);
  useEffect(() => {
    if (!connection) return;
    const current = createRelayAuthorization({
      status: connection.status,
      error: connection.error,
      setUrl: (next) => url.set(next),
    });
    authorization.current = current;
    return () => {
      current.close();
      if (authorization.current === current) authorization.current = null;
    };
  }, [connection, url]);
  useEffect(() => {
    authorization.current?.authorize(grant, authorizationScope);
  }, [connection, grant, authorizationScope]);
}
