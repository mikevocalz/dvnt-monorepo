-- Persist the new, separately collected guest contact on the existing columns.
-- Does not create accounts, backfill contacts, alter prices or grant access.
BEGIN;
DO $migration$
DECLARE signature text; definition text; old text; replacement text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.free_ticket_checkout_atomic(uuid,jsonb,jsonb)',
    'public.paid_ticket_issuance_atomic(uuid,uuid,text,text,bigint,jsonb)'
  ] LOOP
    definition := pg_get_functiondef(signature::regprocedure);
    old := 'guest_email, guest_name, attendee_name,';
    replacement := 'guest_email, guest_name, guest_phone, attendee_name,';
    IF strpos(definition, old) = 0 OR strpos(definition, 't.guest_name, t.attendee_name,') = 0 THEN
      RAISE EXCEPTION 'Unexpected allocator definition for %', signature;
    END IF;
    definition := replace(definition, old, replacement);
    definition := replace(definition, 't.guest_name, t.attendee_name,', 't.guest_name, CASE WHEN v_order.user_id IS NULL THEN t.guest_phone ELSE NULL END, t.attendee_name,');
    IF signature LIKE 'public.free_ticket%' THEN
      IF strpos(definition, 'user_id, guest_email, type, status,') = 0
        OR strpos(definition, 'v_order.user_id, v_order.guest_email, ''event_ticket'',') = 0 THEN
        RAISE EXCEPTION 'Unexpected free-order projection';
      END IF;
      definition := replace(definition, 'user_id, guest_email, type, status,', 'user_id, guest_email, guest_phone, type, status,');
      definition := replace(definition, 'v_order.user_id, v_order.guest_email, ''event_ticket'',', 'v_order.user_id, v_order.guest_email, CASE WHEN v_order.user_id IS NULL THEN v_order.guest_phone ELSE NULL END, ''event_ticket'',');
    END IF;
    EXECUTE definition;
  END LOOP;
END;
$migration$;
COMMIT;
NOTIFY pgrst, 'reload schema';
