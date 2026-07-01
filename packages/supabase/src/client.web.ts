import { createClient } from "@supabase/supabase-js";

const FALLBACK_SUPABASE_URL = "https://npfjanxturvmjyevoyfo.supabase.co";

// Fallback anon key for the SAME public project as FALLBACK_SUPABASE_URL.
// This is intentionally the browser-facing "anon" JWT — it is designed to
// be embedded in a client bundle and is protected server-side by RLS. It
// is NOT a service_role key and does not grant any privilege beyond what
// an unauthenticated visitor has.
//
// Why we ship it as a constant: on Vercel the NEXT_PUBLIC_* Supabase env
// vars were never configured, so every build inlined the empty-key
// placeholder ("anon-key-unset-at-build") into the client bundle. Every
// browser-side supabase call then silently failed — publishing a story,
// creating a post, and creating an event all appeared to "not do
// anything" because the writes never reached the DB. Committing the
// public anon key as a build-time fallback closes this class of
// deployment misconfiguration without giving up any secret material.
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZmphbnh0dXJ2bWp5ZXZveWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MjA0MjMsImV4cCI6MjA4Mzk5NjQyM30.v88MMGqv2db8hn8llr5aToKbKUDOHz-AxZbZYA5RLGM";

// Web reads import.meta.env.VITE_* first, then falls back to EXPO_PUBLIC_*
// (injected into the bundle via Vite `define`) so existing .env keys keep
// working. (PROMPT 0 §3.)
const viteEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> })
  .env ?? {}) as Record<string, string | undefined>;

// Next.js (apps/web) only inlines `process.env.NEXT_PUBLIC_*` into client
// bundles — `EXPO_PUBLIC_*` is undefined in the browser there, which made
// every supabase call land at the FALLBACK_SUPABASE_URL with a placeholder
// anon key and surface as a generic "Failed to send a request to the Edge
// Function" toast. Vite (web-vite) uses VITE_*, native bundler (mobile)
// uses EXPO_PUBLIC_*. Read in priority so each host wins.
const rawUrl =
  viteEnv.VITE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseUrl =
  typeof rawUrl === "string" && rawUrl.startsWith("https://")
    ? rawUrl
    : FALLBACK_SUPABASE_URL;

const rawAnonKey =
  viteEnv.VITE_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabaseAnonKey =
  typeof rawAnonKey === "string" && rawAnonKey.startsWith("eyJ")
    ? rawAnonKey
    : FALLBACK_SUPABASE_ANON_KEY;

// Fall back cleanly to the committed anon key rather than a placeholder
// string that trips supabase-js at runtime — writes and reads keep
// working even when the env var isn't wired.
const clientKey = supabaseAnonKey;

// SSR-safe: on the Next.js server `localStorage` is undefined. Guard every
// access so supabase's session bootstrap / auto-refresh tick can't crash the
// render with "Cannot read properties of undefined (reading 'getItem')".
const hasLocalStorage = (): boolean => typeof localStorage !== "undefined";

const LocalStorageAdapter = {
  getItem: (key: string) => (hasLocalStorage() ? localStorage.getItem(key) : null),
  setItem: (key: string, value: string) => {
    if (hasLocalStorage()) localStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (hasLocalStorage()) localStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, clientKey, {
  auth: {
    storage: LocalStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

console.log("[Supabase] Web client initialized");
