-- Socket-free supplemental checks. This file is not a migration and must
-- only run in the throwaway fixture built by verify-cancellation-sql.cjs.
CREATE FUNCTION fixture_reset() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  TRUNCATE order_addons,ticket_transfers,event_rsvps,tickets,orders,ticket_types,events;
  INSERT INTO events VALUES(1,clock_timestamp()+interval '10 days','before_event',NULL,'Event',0);
  INSERT INTO ticket_types VALUES('00000000-0000-4000-8000-000000000003',1,1);
  INSERT INTO orders VALUES('00000000-0000-4000-8000-000000000002',1,'buyer','paid',0,NULL);
  INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,purchase_amount_cents,order_id) VALUES
    ('00000000-0000-4000-8000-000000000001',1,'00000000-0000-4000-8000-000000000003','buyer','active',0,'00000000-0000-4000-8000-000000000002');
  INSERT INTO event_rsvps VALUES(1,'buyer','going');
END; $$;
CREATE FUNCTION fixture_snapshot() RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object(
 'status',(SELECT status FROM tickets WHERE id='00000000-0000-4000-8000-000000000001'),
 'sold',(SELECT quantity_sold FROM ticket_types WHERE id='00000000-0000-4000-8000-000000000003'),
 'rsvp',(SELECT status FROM event_rsvps WHERE event_id=1 AND user_id='buyer'),
 'attendees',(SELECT total_attendees FROM events WHERE id=1),
 'wallet',(SELECT wallet_voided_at IS NOT NULL FROM tickets WHERE id='00000000-0000-4000-8000-000000000001'));
$$;
CREATE FUNCTION fixture_assert(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF; END;$$;
DO $$ DECLARE r jsonb; before jsonb; mutation text; s text; BEGIN
 PERFORM fixture_reset();
 r:=cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');
 PERFORM fixture_assert(r->>'ok'='true' AND r->>'changed'='true','first cancellation');
 PERFORM fixture_assert(fixture_snapshot()='{"status":"void","sold":0,"rsvp":"not_going","attendees":0,"wallet":true}', 'atomic status/inventory/RSVP/Wallet/count');
 r:=cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');
 PERFORM fixture_assert(r->>'changed'='false','duplicate does not release twice');
 UPDATE events SET refund_policy='none',start_date=clock_timestamp()-interval '1 day';
 r:=cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');
 PERFORM fixture_assert(r->>'ok'='true' AND r->>'changed'='false','replay survives cutoff and policy change');

 FOREACH mutation IN ARRAY ARRAY[
  'UPDATE tickets SET purchase_amount_cents=NULL',
  'UPDATE tickets SET purchase_amount_cents=500',
  'UPDATE tickets SET purchase_amount_cents=-1',
  'UPDATE tickets SET user_id=''other''',
  'UPDATE tickets SET checked_in_at=clock_timestamp()',
  'UPDATE tickets SET transferred_from=''other''',
  'UPDATE tickets SET status=''transfer_pending''',
  'INSERT INTO ticket_transfers VALUES(''00000000-0000-4000-8000-000000000008'',''00000000-0000-4000-8000-000000000001'',''pending'')',
  'UPDATE tickets SET cart_line_item_id=''00000000-0000-4000-8000-000000000009''',
  'UPDATE orders SET cart_id=''00000000-0000-4000-8000-000000000009''',
  'UPDATE orders SET user_id=''other''',
  'UPDATE orders SET total_cents=500',
  'UPDATE orders SET total_cents=NULL',
  'UPDATE orders SET status=''refunded''',
  'UPDATE events SET refund_policy=''none''',
  'UPDATE events SET start_date=NULL',
  'UPDATE events SET start_date=''infinity''::timestamptz',
  'UPDATE events SET start_date=clock_timestamp()+interval ''24 hours''',
  'UPDATE events SET refund_policy=''days_before'',refund_days_before=11'
 ] LOOP
  PERFORM fixture_reset();EXECUTE mutation;before:=fixture_snapshot();
  r:=cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');
  PERFORM fixture_assert(r->>'ok'='false',mutation);
  PERFORM fixture_assert(before=fixture_snapshot(),'no mutation: '||mutation);
 END LOOP;

 PERFORM fixture_reset();
 INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,purchase_amount_cents,order_id) VALUES
  ('00000000-0000-4000-8000-000000000005',1,'00000000-0000-4000-8000-000000000003','buyer','active',0,'00000000-0000-4000-8000-000000000002');
 UPDATE ticket_types SET quantity_sold=2;
 PERFORM cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');
 PERFORM fixture_assert(fixture_snapshot()->>'rsvp'='going' AND fixture_snapshot()->>'attendees'='1','sibling keeps RSVP');
 PERFORM cancel_free_ticket('00000000-0000-4000-8000-000000000005','buyer');
 PERFORM fixture_assert(fixture_snapshot()->>'rsvp'='not_going' AND fixture_snapshot()->>'attendees'='0','last sibling clears RSVP');

 FOREACH s IN ARRAY ARRAY['scanned','transfer_pending'] LOOP
  PERFORM fixture_reset();
  INSERT INTO tickets(id,event_id,user_id,status,purchase_amount_cents) VALUES('00000000-0000-4000-8000-000000000005',1,'buyer',s,0);
  UPDATE ticket_types SET quantity_sold=0;
  PERFORM cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');
  PERFORM fixture_assert(fixture_snapshot()->>'rsvp'='going' AND fixture_snapshot()->>'attendees'='1','scanned/pending sibling remains valid');
  PERFORM fixture_assert(fixture_snapshot()->>'sold'='0','inventory floor');
 END LOOP;

 PERFORM fixture_reset();
 UPDATE tickets SET cart_id='00000000-0000-4000-8000-000000000009',ticket_type_id=NULL;
 INSERT INTO order_addons VALUES('00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','unfulfilled',500);
 r:=cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');
 PERFORM fixture_assert(r->>'ok'='true' AND fixture_snapshot()->>'sold'='1','synthetic group and null tier');
 PERFORM fixture_assert((SELECT status='unfulfilled' AND price_cents=500 FROM order_addons),'no add-on refund or entitlement mutation');
 PERFORM fixture_assert((SELECT status='paid' AND total_cents=0 FROM orders),'no order/money mutation');
 PERFORM fixture_assert(NOT has_function_privilege('authenticated','public.cancel_free_ticket(uuid,text)','EXECUTE'),'authenticated denied');
 PERFORM fixture_assert(NOT has_function_privilege('anon','public.cancel_free_ticket(uuid,text)','EXECUTE'),'anon denied');
 PERFORM fixture_assert(has_function_privilege('service_role','public.cancel_free_ticket(uuid,text)','EXECUTE'),'service only');
END; $$;
CREATE FUNCTION fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected failure';END;$$;
CREATE TRIGGER fixture_inventory_failure BEFORE UPDATE ON ticket_types FOR EACH ROW EXECUTE FUNCTION fixture_failure();
DO $$DECLARE before jsonb; BEGIN
 PERFORM fixture_reset();before:=fixture_snapshot();
 BEGIN PERFORM cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');RAISE EXCEPTION 'failure not injected';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected failure' THEN RAISE; END IF;END;
 PERFORM fixture_assert(before=fixture_snapshot(),'inventory failure rolls back ticket and Wallet');
END;$$;
DROP TRIGGER fixture_inventory_failure ON ticket_types;
CREATE TRIGGER fixture_rsvp_failure BEFORE UPDATE ON event_rsvps FOR EACH ROW EXECUTE FUNCTION fixture_failure();
DO $$DECLARE before jsonb; BEGIN
 PERFORM fixture_reset();before:=fixture_snapshot();
 BEGIN PERFORM cancel_free_ticket('00000000-0000-4000-8000-000000000001','buyer');RAISE EXCEPTION 'failure not injected';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected failure' THEN RAISE; END IF;END;
 PERFORM fixture_assert(before=fixture_snapshot(),'RSVP failure rolls back ticket, inventory and Wallet');
END;$$;
SELECT 'PASS: cancellation sequential PostgreSQL assertions; concurrent socket tests NOT RUN' AS result;
