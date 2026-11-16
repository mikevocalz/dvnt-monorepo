-- Synthetic legacy tables omitted from the narrow settlement fixtures.
CREATE TABLE public.promoter_ledger_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),promoter_id uuid NOT NULL REFERENCES event_promoters(id),
 event_id int NOT NULL REFERENCES events(id),order_id uuid NOT NULL REFERENCES orders(id),entry_type text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 amount_cents int NOT NULL,currency text NOT NULL DEFAULT 'usd',stripe_transfer_id text,
 paid_out_at timestamptz,payout_status text NOT NULL DEFAULT 'pending',payout_note text,
 UNIQUE(order_id,entry_type));
CREATE TABLE public.payouts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id int NOT NULL REFERENCES events(id),status text);

ALTER TABLE promoter_ledger_entries ADD CONSTRAINT promoter_ledger_entries_payout_status_check CHECK(payout_status IN ('pending','paid','held'));
ALTER TABLE promoter_ledger_entries ADD CONSTRAINT promoter_ledger_amount_sign CHECK ((entry_type='earning' AND amount_cents>0) OR (entry_type='reversal' AND amount_cents<0));
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check CHECK(status IN ('pending','paid','failed','on_hold'));
