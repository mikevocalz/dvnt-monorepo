-- Validates the widened tickets_user_or_guest constraint added NOT VALID by
-- 20261002190000_phone_comp_claim_links.sql.
--
-- Its own file because VALIDATE has to run after the NOT VALID add has
-- committed to get the cheap lock. VALIDATE CONSTRAINT takes SHARE UPDATE
-- EXCLUSIVE, which scans public.tickets without blocking INSERT or UPDATE, so
-- checkout, scanning and transfers keep running while it works.
--
-- Every existing row already satisfied the narrower old check
-- (user_id OR guest_email), so this cannot fail on live data.

BEGIN;

ALTER TABLE public.tickets VALIDATE CONSTRAINT tickets_user_or_guest;

COMMIT;
