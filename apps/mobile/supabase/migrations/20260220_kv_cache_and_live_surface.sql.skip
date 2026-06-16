-- Migration: kv_cache table for live-surface payload caching
-- Also grants service_role access for the live-surface edge function.

CREATE TABLE IF NOT EXISTS public.kv_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_kv_cache_updated_at ON public.kv_cache (updated_at);

-- Grant service_role access (required for edge functions)
GRANT ALL ON public.kv_cache TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Comment
COMMENT ON TABLE public.kv_cache IS 'Simple key-value cache for edge functions (e.g. live-surface payload)';
