-- Socket-free real PostgreSQL fallback. Concurrency is intentionally NOT tested.
DO $$
DECLARE
  kind text;
  fn text;
  who text;
  eid integer;
  tid uuid;
  q integer;
  r jsonb;
  first jsonb;
  n integer;
  token text;
BEGIN
  FOREACH kind IN ARRAY ARRAY['member','email','phone'] LOOP
    fn := CASE kind WHEN 'member' THEN 'issue_comp_tickets_atomic' WHEN 'email' THEN 'issue_guest_comp_tickets_atomic' ELSE 'issue_guest_phone_comp_tickets_atomic' END;
    who := CASE kind WHEN 'member' THEN 'member' WHEN 'email' THEN 'guest@example.test' ELSE '+14155550123' END;
    INSERT INTO events(host_id,status,start_date) VALUES('host','published',now()+interval '2 days') RETURNING id INTO eid;
    INSERT INTO ticket_types(event_id,quantity_total,category) VALUES(eid,10,'admission') RETURNING id INTO tid;
    FOR q IN 1..3 LOOP
      EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who,who],q;
      ASSERT (r->>'ok')::boolean, r::text;
      SELECT count(*) INTO n FROM tickets WHERE event_id=eid; ASSERT n=q, 'target must issue only its deficit';
      SELECT quantity_sold INTO n FROM ticket_types WHERE id=tid; ASSERT n=q, 'inventory must match seats';
      EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who],q;
      SELECT count(*) INTO n FROM tickets WHERE event_id=eid; ASSERT n=q, 'retry must not mint';
    END LOOP;
    first := r;
    FOREACH q IN ARRAY ARRAY[0,4,-1,NULL] LOOP
      EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who],q;
      ASSERT NOT (r->>'ok')::boolean, 'invalid quantity must fail';
    END LOOP;
    EXECUTE format('SELECT %I($1,$2,$3,$4)',fn) INTO r USING eid,tid,'host',ARRAY[who];
    ASSERT (r->>'ok')::boolean, 'old four-argument endpoint must work';
    SELECT count(DISTINCT qr_token) INTO n FROM tickets WHERE event_id=eid; ASSERT n=3, 'independent QR per seat';
    IF kind='phone' THEN
      -- The legacy replay rotated the links, use its latest tokens.
      first := r;
      token := first->'links'->0->>'token';
      SELECT claim_comp_ticket(token,'member') INTO r; ASSERT (r->>'ok')::boolean;
      SELECT claim_comp_ticket(token,'other') INTO r; ASSERT r->>'code'='claimed_by_other';
      EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who],3;
      ASSERT jsonb_array_length(r->'links')=2, 'partial claim must leave two resend links';
      SELECT claim_comp_ticket(first->'links'->1->>'token','member') INTO r; ASSERT r->>'code'='invalid_token';
      EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who],3;
      first := r;
      FOR token IN SELECT l->>'token' FROM jsonb_array_elements(first->'links') l LOOP
        SELECT claim_comp_ticket(token,'member') INTO r; ASSERT (r->>'ok')::boolean;
      END LOOP;
      UPDATE tickets SET user_id='recipient' WHERE event_id=eid;
      EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who],3;
      ASSERT jsonb_array_length(r->'links')=0, 'phone origin survives transfer';
    ELSE
      UPDATE tickets SET status='scanned' WHERE event_id=eid;
      EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who],3;
      ASSERT jsonb_array_length(r->'tickets')=0, 'scanned still counts';
      UPDATE tickets SET user_id='recipient',guest_email=NULL,status='active' WHERE id=(SELECT id FROM tickets WHERE event_id=eid LIMIT 1);
      EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who],3;
      ASSERT jsonb_array_length(r->'tickets')=1, 'member/email preserve current-owner count';
    END IF;
    -- New event for capacity, auth and immutable rejection.
    INSERT INTO events(host_id,status,start_date) VALUES('host','published',now()+interval '2 days') RETURNING id INTO eid;
    INSERT INTO ticket_types(event_id,quantity_total,category) VALUES(eid,4,'admission') RETURNING id INTO tid;
    INSERT INTO cart_holds VALUES(tid,1,false,now()+interval '1 hour');
    INSERT INTO ticket_holds VALUES(tid,1,'active',now()+interval '1 hour');
    EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'host',ARRAY[who],3;
    ASSERT NOT (r->>'ok')::boolean AND (r->>'would_exceed')::boolean AND (r->>'remaining')::integer=2, 'held inventory must refuse 3';
    SELECT count(*) INTO n FROM tickets WHERE event_id=eid; ASSERT n=0, 'no partial issuance';
    EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'stranger',ARRAY[who],2;
    ASSERT NOT (r->>'ok')::boolean, 'stranger must fail';
    INSERT INTO event_co_organizers VALUES(eid,'admin','admin',true),(eid,'scanner','scanner',true);
    EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'scanner',ARRAY[who],2;
    ASSERT NOT (r->>'ok')::boolean, 'scanner cannot comp';
    EXECUTE format('SELECT %I($1,$2,$3,$4,$5)',fn) INTO r USING eid,tid,'admin',ARRAY[who],2;
    ASSERT (r->>'ok')::boolean, 'admin can comp';
    ASSERT NOT has_function_privilege('authenticated',format('%I(integer,uuid,text,text[],integer)',fn),'EXECUTE');
    ASSERT NOT has_function_privilege('anon',format('%I(integer,uuid,text,text[])',fn),'EXECUTE');
    ASSERT has_function_privilege('service_role',format('%I(integer,uuid,text,text[],integer)',fn),'EXECUTE');
  END LOOP;
  RAISE NOTICE 'PASS: comp quantity sequential PostgreSQL assertions; concurrency NOT RUN';
END;
$$;
SELECT 'PASS: comp quantity sequential PostgreSQL assertions; concurrency NOT RUN';

-- Atomic acceptance rollback, recipient/expiry guards and independent siblings.
CREATE FUNCTION fixture_reject_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='accepted' AND current_setting('fixture.reject_acceptance',true)='on' THEN
    RAISE EXCEPTION 'fixture rollback';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fixture_reject_acceptance BEFORE UPDATE ON ticket_transfers FOR EACH ROW EXECUTE FUNCTION fixture_reject_acceptance();
DO $$
DECLARE
  eid integer; tid uuid; ticket_id uuid; transfer_id uuid; r jsonb; n integer;
  original_qr text; failed boolean := false;
BEGIN
  INSERT INTO events(host_id,status,start_date) VALUES('host','published',now()+interval '2 days') RETURNING id INTO eid;
  INSERT INTO ticket_types(event_id,category) VALUES(eid,'admission') RETURNING id INTO tid;
  SELECT issue_comp_tickets_atomic(eid,tid,'host',ARRAY['member'],3) INTO r;
  ticket_id := (r->'tickets'->0->>'id')::uuid;
  SELECT qr_token INTO original_qr FROM tickets WHERE id=ticket_id;
  UPDATE tickets SET status='transfer_pending',guest_lookup_token='old-guest-link' WHERE id=ticket_id;
  INSERT INTO ticket_transfers(ticket_id,from_user_id,to_user_id,expires_at)
    VALUES(ticket_id,'member','recipient',now()+interval '1 day') RETURNING id INTO transfer_id;
  SELECT accept_ticket_transfer_atomic(transfer_id,'other',eid,repeat('1',64),'signed') INTO r;
  ASSERT NOT (r->>'ok')::boolean, 'wrong recipient';
  SELECT accept_ticket_transfer_atomic(transfer_id,'recipient',eid+1,repeat('1',64),'signed') INTO r;
  ASSERT NOT (r->>'ok')::boolean, 'signed payload event mismatch';
  UPDATE tickets SET status='refunded' WHERE id=ticket_id;
  SELECT accept_ticket_transfer_atomic(transfer_id,'recipient',eid,repeat('1',64),'signed') INTO r;
  ASSERT NOT (r->>'ok')::boolean, 'refunded comp cannot move';
  UPDATE tickets SET status='transfer_pending' WHERE id=ticket_id;
  PERFORM set_config('fixture.reject_acceptance','on',true);
  BEGIN
    PERFORM accept_ticket_transfer_atomic(transfer_id,'recipient',eid,repeat('1',64),'signed');
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM='fixture rollback'; failed := true;
  END;
  ASSERT failed, 'failure must occur after ownership update';
  ASSERT (SELECT user_id='member' AND status='transfer_pending' AND qr_token=original_qr AND guest_lookup_token='old-guest-link' FROM tickets WHERE id=ticket_id), 'ownership and credentials must roll back';
  ASSERT (SELECT status='pending' FROM ticket_transfers WHERE id=transfer_id), 'accepted state must roll back';
  PERFORM set_config('fixture.reject_acceptance','off',true);
  SELECT accept_ticket_transfer_atomic(transfer_id,'recipient',eid,repeat('1',64),'signed') INTO r;
  ASSERT (r->>'ok')::boolean, 'retry must succeed';
  ASSERT (SELECT user_id='recipient' AND status='active' AND guest_lookup_token IS NULL AND purchase_amount_cents=0 FROM tickets WHERE id=ticket_id);
  ASSERT (SELECT status='accepted' FROM ticket_transfers WHERE id=transfer_id);
  SELECT count(*) INTO n FROM tickets WHERE event_id=eid AND user_id='member'; ASSERT n=2, 'siblings stay with original member';
  SELECT accept_ticket_transfer_atomic(transfer_id,'recipient',eid,repeat('2',64),'second-signed') INTO r;
  ASSERT NOT (r->>'ok')::boolean, 'duplicate acceptance cannot rotate again';
  ASSERT NOT has_function_privilege('anon','accept_ticket_transfer_atomic(uuid,text,integer,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','accept_ticket_transfer_atomic(uuid,text,integer,text,text)','EXECUTE');
  ASSERT has_function_privilege('service_role','accept_ticket_transfer_atomic(uuid,text,integer,text,text)','EXECUTE');
  RAISE NOTICE 'PASS: atomic acceptance sequential PostgreSQL assertions; concurrency NOT RUN';
END;
$$;
SELECT 'PASS: atomic acceptance sequential PostgreSQL assertions; concurrency NOT RUN';
