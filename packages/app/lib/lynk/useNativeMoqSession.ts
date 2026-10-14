import { useEffect, useRef } from "react";
import { useSession } from "react-native-moq";

/** Native useSession exposes connect/disconnect but does not retry a closed
 * session. Mirror the web Reload connection's recovery while this room lives. */
export function useNativeMoqSession(relayUrl: string | undefined, enabled: boolean) {
  const session = useSession(relayUrl ?? "");
  const attempts = useRef(0);
  const { connect, disconnect, state } = session;

  useEffect(() => {
    if (!relayUrl || !enabled) return;
    attempts.current = 0;
    connect();
    return () => disconnect();
  }, [relayUrl, enabled, connect, disconnect]);

  useEffect(() => {
    if (!relayUrl || !enabled) return;
    if (state === "connected") {
      attempts.current = 0;
      return;
    }
    if (state !== "closed" && !state.startsWith("error:")) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts.current++, 5));
    const timer = setTimeout(() => connect(), delay);
    return () => clearTimeout(timer);
  }, [relayUrl, enabled, state, connect]);

  return session;
}
