// Shim — the supabase client lives in @dvnt/supabase (PROMPT 0 §3), same as
// packages/app/lib/supabase/client.ts. This path is preserved so the existing
// importers keep resolving unchanged.
//
// This file previously built its own client via createDvntSupabaseClient. The
// config was identical (ExpoSecureStoreAdapter, persistSession: false,
// autoRefreshToken: false, detectSessionInUrl: false), so collapsing it changes
// no behaviour and carries no logout risk — nothing was persisted to storage in
// either version. What it does fix: the app was constructing TWO client
// instances, and with persistSession:false each holds its auth in memory only,
// so a setSession from the JWT bridge on one was invisible to the other.
export * from "@dvnt/supabase";
