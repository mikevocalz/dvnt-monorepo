import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare const process: { env: SupabaseRuntimeEnv } | undefined;

export const FALLBACK_SUPABASE_URL = 'https://npfjanxturvmjyevoyfo.supabase.co';

export type SupabaseStorageAdapter = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

export type SupabaseRuntimeEnv = Record<string, string | undefined>;

export type DvntSupabaseClientOptions = {
  env?: SupabaseRuntimeEnv;
  url?: string;
  anonKey?: string;
  storage?: SupabaseStorageAdapter;
  autoRefreshToken?: boolean;
  persistSession?: boolean;
  detectSessionInUrl?: boolean;
  onMissingAnonKey?: (message: string) => void;
  onInitialized?: (message: string) => void;
};

export function createBrowserStorage(): SupabaseStorageAdapter {
  return {
    getItem: (key) => {
      if (typeof window === 'undefined') {
        return null;
      }

      return window.localStorage.getItem(key);
    },
    setItem: (key, value) => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, value);
      }
    },
    removeItem: (key) => {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
    },
  };
}

export function getDefaultSupabaseEnv(): SupabaseRuntimeEnv {
  const nodeEnv =
    typeof process !== 'undefined' && process?.env ? process.env : {};
  const viteEnv =
    typeof import.meta !== 'undefined'
      ? ((import.meta as unknown as { env?: SupabaseRuntimeEnv }).env ?? {})
      : {};

  return { ...nodeEnv, ...viteEnv };
}

export function resolveSupabaseUrl(env: SupabaseRuntimeEnv = getDefaultSupabaseEnv()) {
  const rawUrl = env.EXPO_PUBLIC_SUPABASE_URL ?? env.VITE_SUPABASE_URL;

  return typeof rawUrl === 'string' && rawUrl.startsWith('https://')
    ? rawUrl
    : FALLBACK_SUPABASE_URL;
}

export function resolveSupabaseAnonKey(
  env: SupabaseRuntimeEnv = getDefaultSupabaseEnv(),
) {
  const rawAnonKey =
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;

  return typeof rawAnonKey === 'string' && rawAnonKey.startsWith('eyJ')
    ? rawAnonKey
    : '';
}

export function createDvntSupabaseClient(
  options: DvntSupabaseClientOptions = {},
): SupabaseClient {
  const env = options.env ?? getDefaultSupabaseEnv();
  const supabaseUrl = options.url ?? resolveSupabaseUrl(env);
  const supabaseAnonKey = options.anonKey ?? resolveSupabaseAnonKey(env);

  if (!supabaseAnonKey) {
    options.onMissingAnonKey?.(
      '[Supabase] public anon key is missing. Set EXPO_PUBLIC_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY.',
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: (options.storage ?? createBrowserStorage()) as never,
      autoRefreshToken: options.autoRefreshToken ?? false,
      persistSession: options.persistSession ?? false,
      detectSessionInUrl: options.detectSessionInUrl ?? false,
    },
  });

  options.onInitialized?.('[Supabase] Client initialized (anon only)');

  return supabase;
}
