// Shim — the supabase client now lives in @dvnt/supabase (PROMPT 0 §3). This
// historic path is preserved so the ~130 existing importers keep resolving
// unchanged. Platform resolution (native SecureStore vs web localStorage) is
// handled by @dvnt/supabase's package `exports` conditions.
export * from "@dvnt/supabase";
