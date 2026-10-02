-- Consent-based member proximity.
--
-- Raw coordinates are service-role only. Clients never select another member's
-- lat/lng; the member-proximity edge function returns only a rounded distance
-- or a city-only fallback. Visibility is opt-in and expires automatically.
BEGIN;

CREATE TABLE IF NOT EXISTS public.member_proximity_presence (
  user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  city_id bigint REFERENCES public.cities(id) ON DELETE SET NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters double precision,
  share_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_proximity_presence_share_until_idx
  ON public.member_proximity_presence (share_until);

ALTER TABLE public.member_proximity_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_proximity_presence FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.member_proximity_presence TO service_role;

COMMENT ON TABLE public.member_proximity_presence IS
  'Time-bounded opt-in location snapshots used only for server-computed member proximity. Raw coordinates are never client-readable.';

COMMIT;

NOTIFY pgrst, 'reload schema';
