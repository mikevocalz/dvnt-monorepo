/** Better Auth owns identity. Bridge credentials never outlive their session boundary. */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { setBridgeAccessToken, setBridgeTokenMinter } from "../supabase/client";
import { getBetterAuthToken } from "./identity";
import { getSessionLifecycle, subscribeSessionLifecycle } from "./session-lifecycle";
import { bridgeClaims, createAccountBridgeCache, type BridgeJwt } from "./account-bridge-cache";

// Never read the old unowned persisted JWT. Cold starts must verify Better Auth.
try {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.localStorage.removeItem("dvnt-supabase-jwt-v1");
  } else { void SecureStore.deleteItemAsync("dvnt-supabase-jwt-v1").catch(() => {}); }
} catch { /* storage is optional */ }

async function mintRemote(token: string): Promise<BridgeJwt | null> {
  try {

    const supabaseUrl =
      process.env.EXPO_PUBLIC_SUPABASE_URL ||
      "https://npfjanxturvmjyevoyfo.supabase.co";
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

    // ponytail: hard timeout so a hung/cold-starting mint edge fn can't freeze
    // callers. This runs on the publish path (createEvent awaits it) — a
    // never-resolving fetch here shows as "stuck on publishing" on web+mobile.
    // On abort we fall through to null → anon-only, exactly like any mint error.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(
        `${supabaseUrl}/functions/v1/mint-supabase-jwt`,
        {
          method: "POST",
          headers: {
            // x-auth-token avoids the Supabase gateway rejecting a
            // non-JWT in Authorization (the verify-session helper
            // accepts both).
            "x-auth-token": token,
            apikey: anonKey,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      // 503 = bridge intentionally disabled (no JWT secret); silent fallback.
      // Other 4xx/5xx — log and fall through.
      if (res.status !== 503) {
        console.warn(
          "[SupabaseJwt] mint failed:",
          res.status,
          await res.text().catch(() => ""),
        );
      }
      return null;
    }
    const body = await res.json();
    if (!body?.ok || !body?.data?.access_token) return null;
    const claims = bridgeClaims(body.data.access_token);
    if (!claims) return null;
    return { accessToken: body.data.access_token, ...claims };
  } catch (err) {
    console.warn("[SupabaseJwt] mint error:", err);
    return null;
  }
}


const bridge = createAccountBridgeCache({
  getSessionToken: () => getSessionLifecycle().ready ? getBetterAuthToken() : Promise.resolve(null),
  mint: mintRemote,
  onToken: setBridgeAccessToken,
});
subscribeSessionLifecycle(() => bridge.invalidate());

// EVERY request goes through this resolver, including a fresh attached token.
setBridgeTokenMinter(async () => (await bridge.get())?.accessToken ?? null);

export async function ensureSupabaseJwt(expectedAuthId?: string): Promise<boolean> {
  const jwt = await bridge.get();
  return !!jwt && (!expectedAuthId || jwt.subject === expectedAuthId);
}
let refreshTimer: ReturnType<typeof setInterval> | null = null;
export function startSupabaseJwtAutoRefresh(): () => void {
  stopSupabaseJwtAutoRefresh();
  void ensureSupabaseJwt();
  refreshTimer = setInterval(() => { void ensureSupabaseJwt(); }, 5 * 60 * 1000);
  return stopSupabaseJwtAutoRefresh;
}
export function stopSupabaseJwtAutoRefresh(): void {
  if (refreshTimer != null) clearInterval(refreshTimer);
  refreshTimer = null;
}
export async function clearSupabaseJwt(): Promise<void> { bridge.invalidate(); }
export async function reauthAfter401(): Promise<boolean> {
  bridge.invalidate();
  return ensureSupabaseJwt();
}
