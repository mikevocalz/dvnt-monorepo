-- A share widget only: no orders, holds, checkout, Stripe, fees or fulfillment changes.
BEGIN;
CREATE TABLE public.event_ticket_widgets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id integer NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
 allowed_origin text NOT NULL CHECK(length(allowed_origin) BETWEEN 9 AND 255),
 published boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_ticket_widgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_ticket_widgets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.event_ticket_widgets TO service_role;
COMMENT ON TABLE public.event_ticket_widgets IS 'Owner/admin-managed marketing widgets; buyers complete the existing DVNT checkout in a new tab. Not embedded payment authorization.';
COMMIT;
