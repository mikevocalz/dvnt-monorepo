-- Source-only rollout: co-host catalog edits must not rewrite inventory or
-- move existing add-ons/variants between parents. RLS remains authoritative
-- for which events a caller may manage.
BEGIN;
CREATE OR REPLACE FUNCTION public.guard_cohost_addon_catalog_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_sub text := NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub';
  v_owner boolean;
  v_catalog text[];
BEGIN
  -- Issuance/hold/refund functions run SECURITY DEFINER, even with buyer JWTs.
  -- Preserve those trusted inventory updates and service-role maintenance.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'ticket_addons' THEN
    IF NEW.requires_tier_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ticket_types t WHERE t.id = NEW.requires_tier_id AND t.event_id = NEW.event_id
    ) THEN
      RAISE EXCEPTION 'An add-on can only require a ticket tier from its own event' USING ERRCODE = '23514';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id AND e.host_id = v_sub)
      INTO v_owner;
    IF v_owner AND (TG_OP = 'INSERT' OR OLD.event_id = NEW.event_id) THEN RETURN NEW; END IF;
    v_catalog := ARRAY['name','description','addon_type','binding_mode','price_cents',
      'min_price_cents','currency','quantity_total','has_variants','requires_tier_id',
      'is_redeemable','image_url','sort_order','status','updated_at'];
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.ticket_addons a JOIN public.events e ON e.id = a.event_id
      WHERE a.id = NEW.addon_id AND e.host_id = v_sub) INTO v_owner;
    IF v_owner AND (TG_OP = 'INSERT' OR OLD.addon_id = NEW.addon_id) THEN RETURN NEW; END IF;
    v_catalog := ARRAY['name','option_values','price_cents','quantity_total','sku','sort_order','updated_at'];
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.quantity_sold, 0) <> 0 OR COALESCE(NEW.quantity_held, 0) <> 0 THEN
      RAISE EXCEPTION 'Add-on inventory counters are server-managed' USING ERRCODE = '42501';
    END IF;
  ELSIF (to_jsonb(OLD) - v_catalog) IS DISTINCT FROM (to_jsonb(NEW) - v_catalog) THEN
    RAISE EXCEPTION 'Only add-on catalog fields may be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cohost_addon_catalog_write() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_cohost_addon_catalog_write ON public.ticket_addons;
CREATE TRIGGER guard_cohost_addon_catalog_write BEFORE INSERT OR UPDATE ON public.ticket_addons
  FOR EACH ROW EXECUTE FUNCTION public.guard_cohost_addon_catalog_write();
DROP TRIGGER IF EXISTS guard_cohost_addon_catalog_write ON public.ticket_addon_variants;
CREATE TRIGGER guard_cohost_addon_catalog_write BEFORE INSERT OR UPDATE ON public.ticket_addon_variants
  FOR EACH ROW EXECUTE FUNCTION public.guard_cohost_addon_catalog_write();
COMMIT;
