/**
 * Better Auth client — web (Vite). Extracted verbatim from the app's
 * lib/auth-client.web.ts (PROMPT 0 §3): cookie client (credentials: include) +
 * username + passkey, identical origin/basePath derivation. No expo-secure-store,
 * no @better-auth/expo.
 */
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

// Same-origin proxy (Next): when EXPO_PUBLIC_AUTH_SAME_ORIGIN is set, point the
// client at this app's own origin (+ basePath /api/auth). Next rewrites
// /api/auth/* → the Supabase edge function, so the session cookie is FIRST-party
// and actually persists (cross-origin to supabase.co makes it third-party →
// dropped → login/likes/comments never authenticate). Falls back to the direct
// edge-function URL on Vite / SSR / native.
const SAME_ORIGIN =
  process.env.EXPO_PUBLIC_AUTH_SAME_ORIGIN === "true" &&
  typeof window !== "undefined";

const AUTH_FULL_URL = SAME_ORIGIN
  ? window.location.origin
  : (typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, string | undefined> })
          .env?.VITE_AUTH_URL
      : undefined) ||
    process.env.EXPO_PUBLIC_AUTH_URL ||
    "https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth";

const AUTH_ORIGIN = new URL(AUTH_FULL_URL).origin;
const AUTH_PATH_PREFIX = new URL(AUTH_FULL_URL).pathname.replace(/\/$/, "");
const AUTH_BASE_PATH = `${AUTH_PATH_PREFIX}/api/auth`;

console.log("[AuthClient:web] AUTH_ORIGIN:", AUTH_ORIGIN);
console.log("[AuthClient:web] AUTH_BASE_PATH:", AUTH_BASE_PATH);

export const authClient = createAuthClient({
  baseURL: AUTH_ORIGIN,
  basePath: AUTH_BASE_PATH,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [usernameClient(), passkeyClient()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
