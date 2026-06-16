import { createClient } from "@supabase/supabase-js";

const FALLBACK_SUPABASE_URL = "https://npfjanxturvmjyevoyfo.supabase.co";

// Web reads import.meta.env.VITE_* first, then falls back to EXPO_PUBLIC_*
// (injected into the bundle via Vite `define`) so existing .env keys keep
// working. (PROMPT 0 §3.)
const viteEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> })
  .env ?? {}) as Record<string, string | undefined>;

const rawUrl = viteEnv.VITE_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseUrl =
  typeof rawUrl === "string" && rawUrl.startsWith("https://")
    ? rawUrl
    : FALLBACK_SUPABASE_URL;

const rawAnonKey =
  viteEnv.VITE_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabaseAnonKey =
  typeof rawAnonKey === "string" && rawAnonKey.startsWith("eyJ")
    ? rawAnonKey
    : "";

if (!supabaseAnonKey) {
  console.error(
    "[Supabase] anon key missing! Set VITE_SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env",
  );
}

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: LocalStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

console.log("[Supabase] Web client initialized");
