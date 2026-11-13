-- Disposable synthetic fixture ONLY; never run against an existing database.
UPDATE events SET payout_status='on_hold',payout_release_at=NULL;
UPDATE event_promoters SET user_id='fixture-promoter',stripe_account_id='acct_fixture';
INSERT INTO orders(id,event_id,status,type,currency,total_cents,subtotal_cents,organizer_fee_cents,promoter_id,promoter_code,promoter_commission_amount_cents,stripe_payment_intent_id)
 VALUES('00000000-0000-4000-8000-000000000011',1,'paid','event_ticket','usd',11000,10000,500,'00000000-0000-4000-8000-000000000002','FIXTURE',1000,'pi_fixture');
INSERT INTO promoter_attributions(order_id,promoter_id,locked_promoter_commission_amount_cents)
 VALUES('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002',1000);
INSERT INTO promoter_ledger_entries(id,promoter_id,event_id,order_id,entry_type,amount_cents)
 VALUES('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002',1,'00000000-0000-4000-8000-000000000011','earning',1000);
INSERT INTO dvnt_settlement.external_operators VALUES('fixture-operator',true);
INSERT INTO dvnt_settlement.external_operator_scopes VALUES('fixture-operator',1,'00000000-0000-4000-8000-000000000002',true,true,clock_timestamp()+interval '1 hour');
INSERT INTO dvnt_settlement.external_recipients(id,promoter_id,provider,beneficiary_reference,verified_by,recipient_user_id)
 VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','fixture_provider','fixture-beneficiary','fixture-operator','fixture-promoter');
UPDATE dvnt_settlement.external_recording_controls SET enabled=true,reporting_enabled=true;
INSERT INTO dvnt_settlement.external_event_reviews(event_id,reviewed_by,reviewed_at,expires_at,proof_sha256,attestation) VALUES(1,'fixture-operator',clock_timestamp(),clock_timestamp()+interval '10 minutes',repeat('b',64),'{"workers_drained":true,"stripe_destinations_reconciled":true,"unknown_outcomes_absent":true,"source_refunds_disputes_reviewed":true}');

SELECT public.settlement_report_external_payment('fixture-operator',1,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000041','fixture-report');
