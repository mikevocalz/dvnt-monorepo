import { createClient } from "@supabase/supabase-js";
import { withFunctionObserver } from "./function-observer";
import { createBridgeTransport } from "./bridge-transport";

export { setFunctionResponseObserver } from "./function-observer";

const FALLBACK_SUPABASE_URL = "https://npfjanxturvmjyevoyfo.supabase.co";

// Validate env var is a real URL — Metro can inline garbage values in OTA builds
const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseUrl =
  typeof rawUrl === "string" && rawUrl.startsWith("https://")
    ? rawUrl
    : FALLBACK_SUPABASE_URL;
const rawAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabaseAnonKey =
  typeof rawAnonKey === "string" && rawAnonKey.startsWith("eyJ")
    ? rawAnonKey
    : "";

if (!supabaseAnonKey) {
  console.error(
    "[Supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY is missing! Set it in .env",
  );
}

// Better Auth is the session authority on native too. Avoid asynchronous
// GoTrue setSession: an old setSession completion can resurrect account A.
const bridge = createBridgeTransport(supabaseAnonKey);
export function setBridgeAccessToken(token: string | null) {
  bridge.setToken(token);
  // Explicit anon reset also supersedes pending Realtime auth callbacks.
  void supabase.realtime.setAuth(token ?? supabaseAnonKey).catch(() => {
    console.warn("[Supabase] Realtime credential update failed");
  });
}
export const setBridgeTokenMinter = bridge.setMinter;
export const getBridgeRequestEpoch = bridge.requestEpoch;
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: bridge.accessToken,
  global: { fetch: withFunctionObserver(bridge.guardFetch((input, init) => fetch(input, init))) },
});
