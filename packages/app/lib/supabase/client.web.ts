// Shim — see client.ts. The web supabase client now lives in @dvnt/supabase
// (resolved via the package's "import" export condition). Kept so any direct
// `.web` import of this historic path keeps working.
export * from "@dvnt/supabase";
