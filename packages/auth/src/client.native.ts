/**
 * Better Auth client — native (Expo). Extracted verbatim from the app's
 * lib/auth-client.ts (PROMPT 0 §3): @better-auth/expo plugin + SecureStore +
 * username + passkey, with origin/basePath derived against the Supabase Edge
 * Function. App-level plumbing (handleSignOut, getAuthToken, query-cache) stays
 * in @dvnt/app and imports this.
 */
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { usernameClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import * as SecureStore from "expo-secure-store";

// Auth server URL — Better Auth hosted in Supabase Edge Function (CANONICAL)
// IMPORTANT: Better Auth client uses baseURL as origin-only and appends basePath.
// baseURL MUST be just the origin (no path), basePath routes through the Edge Function.
const AUTH_FULL_URL =
  process.env.EXPO_PUBLIC_AUTH_URL ||
  "https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth";

// Extract origin from the full URL (e.g. "https://npfjanxturvmjyevoyfo.supabase.co")
const AUTH_ORIGIN = new URL(AUTH_FULL_URL).origin;
// Extract the path prefix (e.g. "/functions/v1/auth") and append Better Auth's route prefix
const AUTH_PATH_PREFIX = new URL(AUTH_FULL_URL).pathname.replace(/\/$/, "");
const AUTH_BASE_PATH = `${AUTH_PATH_PREFIX}/api/auth`;

console.log("[AuthClient] AUTH_ORIGIN:", AUTH_ORIGIN);
console.log("[AuthClient] AUTH_BASE_PATH:", AUTH_BASE_PATH);

// Create the Better Auth client
export const authClient = createAuthClient({
  baseURL: AUTH_ORIGIN,
  basePath: AUTH_BASE_PATH,
  plugins: [
    expoClient({
      scheme: "dvnt",
      storagePrefix: "dvnt",
      storage: SecureStore,
      cookiePrefix: "better-auth",
    }),
    usernameClient(),
    passkeyClient(),
  ],
});

// Export hooks and methods
export const { signIn, signUp, signOut, useSession, getSession } = authClient;
