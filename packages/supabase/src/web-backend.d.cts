export type WebBackend = { supabaseUrl: string; supabaseAnonKey: string };
export function resolveWebBackend(rawUrl?: string, rawAnonKey?: string): WebBackend;
export function resolveNextWebBackend(env: Record<string, string | undefined>): WebBackend & { authUrl: string };
