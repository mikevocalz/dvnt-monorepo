import { resolveWebBackend } from '../../../../packages/supabase/src/web-backend.cjs';

/** Public build configuration only. Never borrow a production fallback here. */
export function getPublicWebBackend() {
  // Keep direct property reads so Next inlines the pair resolved in next.config.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || key === undefined) {
    throw new Error('Public web backend configuration is unavailable');
  }
  return resolveWebBackend(url, key);
}
