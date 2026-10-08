/**
 * Lets the app read edge-function responses without touching every caller.
 *
 * The app registers an observer (the verified-only popup does); the client's
 * fetch hands it a clone of each functions response. Registering from the app
 * side keeps this package free of any app import, the same way
 * `setBridgeTokenMinter` works. The observer never changes what the caller
 * receives, and its errors are swallowed so it cannot break a request.
 */
export type FunctionResponseObserver = {
  /** Cheap filter on the function name; only matches are cloned. */
  matches: (fnName: string) => boolean;
  observe: (fnName: string, response: Response) => void;
};

let observer: FunctionResponseObserver | null = null;

export function setFunctionResponseObserver(next: FunctionResponseObserver | null): void {
  observer = next;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const FN_PATH = /\/(?:functions\/v1|api\/fn)\/([^/?#]+)/;

/** Wraps a fetch so functions responses reach the registered observer. */
export function withFunctionObserver(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await base(input as RequestInfo, init);
    const current = observer;
    if (!current) return response;
    try {
      const match = FN_PATH.exec(urlOf(input as RequestInfo | URL));
      const fnName = match ? decodeURIComponent(match[1]) : null;
      if (fnName && current.matches(fnName)) current.observe(fnName, response.clone());
    } catch {
      // An observer must never cost the caller its response.
    }
    return response;
  };
}
