-- ════════════════════════════════════════════════════════════════════════
-- WS-3 add-ons — host catalog write path.
--
-- GAP: 20260613000100 enabled RLS on ticket_addons / ticket_addon_variants
-- with SELECT-only policies ("writes via service role"), but the add-on
-- catalog UI (event create/edit) writes through the SAME authenticated
-- PostgREST path the ticket_types editor uses (ticketTypesApi.create/update,
-- host-scoped policies from 20260301). No addon-CRUD edge function exists and
-- none may be added in this workstream, so host management is blocked without
-- these policies.
--
-- Scope: INSERT / UPDATE / DELETE for the event's host or an accepted
-- co-organizer with role editor/admin (mirrors the 20260301 ticket_types
-- predicate; jwt `sub` = BetterAuth id via mint-supabase-jwt bridge).
-- DELETE stays safe for sold items: order_addons.addon_id / variant_id are
-- ON DELETE RESTRICT, so a purchased add-on cannot be hard-deleted — hosts
-- retire those via status='ended' instead.
-- Buyer-side purchase writes (order_addons, quantity_sold/held) remain
-- service-role-only through the cart RPCs. Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_addons TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_addon_variants TO authenticated;

-- Host-or-editor predicate is inlined (CREATE POLICY cannot reference a
-- helper created in the same DO block portably across shadow DBs).

DO $$ BEGIN
  -- ── ticket_addons ──────────────────────────────────────────────────────
  DROP POLICY IF EXISTS ticket_addons_host_insert ON public.ticket_addons;
  CREATE POLICY ticket_addons_host_insert ON public.ticket_addons
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = ticket_addons.event_id
          AND (
            e.host_id = (current_setting('request.jwt.claims', true)::json->>'sub')
            OR EXISTS (
              SELECT 1 FROM public.event_co_organizers co
              WHERE co.event_id = e.id
                AND co.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
                AND co.accepted = true
                AND co.role IN ('editor', 'admin')
            )
          )
      )
    );

  DROP POLICY IF EXISTS ticket_addons_host_update ON public.ticket_addons;
  CREATE POLICY ticket_addons_host_update ON public.ticket_addons
    FOR UPDATE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = ticket_addons.event_id
          AND (
            e.host_id = (current_setting('request.jwt.claims', true)::json->>'sub')
            OR EXISTS (
              SELECT 1 FROM public.event_co_organizers co
              WHERE co.event_id = e.id
                AND co.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
                AND co.accepted = true
                AND co.role IN ('editor', 'admin')
            )
          )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = ticket_addons.event_id
          AND (
            e.host_id = (current_setting('request.jwt.claims', true)::json->>'sub')
            OR EXISTS (
              SELECT 1 FROM public.event_co_organizers co
              WHERE co.event_id = e.id
                AND co.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
                AND co.accepted = true
                AND co.role IN ('editor', 'admin')
            )
          )
      )
    );

  DROP POLICY IF EXISTS ticket_addons_host_delete ON public.ticket_addons;
  CREATE POLICY ticket_addons_host_delete ON public.ticket_addons
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = ticket_addons.event_id
          AND (
            e.host_id = (current_setting('request.jwt.claims', true)::json->>'sub')
            OR EXISTS (
              SELECT 1 FROM public.event_co_organizers co
              WHERE co.event_id = e.id
                AND co.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
                AND co.accepted = true
                AND co.role IN ('editor', 'admin')
            )
          )
      )
    );

  -- ── ticket_addon_variants (reach the event through the parent add-on) ──
  DROP POLICY IF EXISTS addon_variants_host_insert ON public.ticket_addon_variants;
  CREATE POLICY addon_variants_host_insert ON public.ticket_addon_variants
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.ticket_addons a
        JOIN public.events e ON e.id = a.event_id
        WHERE a.id = ticket_addon_variants.addon_id
          AND (
            e.host_id = (current_setting('request.jwt.claims', true)::json->>'sub')
            OR EXISTS (
              SELECT 1 FROM public.event_co_organizers co
              WHERE co.event_id = e.id
                AND co.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
                AND co.accepted = true
                AND co.role IN ('editor', 'admin')
            )
          )
      )
    );

  DROP POLICY IF EXISTS addon_variants_host_update ON public.ticket_addon_variants;
  CREATE POLICY addon_variants_host_update ON public.ticket_addon_variants
    FOR UPDATE TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.ticket_addons a
        JOIN public.events e ON e.id = a.event_id
        WHERE a.id = ticket_addon_variants.addon_id
          AND (
            e.host_id = (current_setting('request.jwt.claims', true)::json->>'sub')
            OR EXISTS (
              SELECT 1 FROM public.event_co_organizers co
              WHERE co.event_id = e.id
                AND co.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
                AND co.accepted = true
                AND co.role IN ('editor', 'admin')
            )
          )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.ticket_addons a
        JOIN public.events e ON e.id = a.event_id
        WHERE a.id = ticket_addon_variants.addon_id
          AND (
            e.host_id = (current_setting('request.jwt.claims', true)::json->>'sub')
            OR EXISTS (
              SELECT 1 FROM public.event_co_organizers co
              WHERE co.event_id = e.id
                AND co.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
                AND co.accepted = true
                AND co.role IN ('editor', 'admin')
            )
          )
      )
    );

  DROP POLICY IF EXISTS addon_variants_host_delete ON public.ticket_addon_variants;
  CREATE POLICY addon_variants_host_delete ON public.ticket_addon_variants
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.ticket_addons a
        JOIN public.events e ON e.id = a.event_id
        WHERE a.id = ticket_addon_variants.addon_id
          AND (
            e.host_id = (current_setting('request.jwt.claims', true)::json->>'sub')
            OR EXISTS (
              SELECT 1 FROM public.event_co_organizers co
              WHERE co.event_id = e.id
                AND co.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
                AND co.accepted = true
                AND co.role IN ('editor', 'admin')
            )
          )
      )
    );
EXCEPTION WHEN others THEN NULL; END $$;
