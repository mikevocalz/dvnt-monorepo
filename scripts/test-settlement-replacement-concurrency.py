#!/usr/bin/env python3
"""Real overlapping sessions, synthetic evidence only, disposable local CI DBs.
Never connects to a remote database or calls a provider/email transport.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('settlement_locks', ROOT / 'scripts/test-settlement-concurrency.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
call, literal, PREFIX = base.call, base.literal, base.PREFIX
TIER = '00000000-0000-4000-8000-000000000010'

class Database(base.Database):
    def __enter__(self):
        self.name = 'dvnt_replacement_test_' + uuid.uuid4().hex
        self.created = False
        subprocess.run(PREFIX + ['createdb', '-h', '/var/run/postgresql', self.name], check=True, timeout=20)
        self.created = True
        self.command = PREFIX + ['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-d',self.name]
        try:
            schema = (ROOT / 'scripts/fixtures/settlement/schema.sql').read_text()
            for role in ('anon','authenticated','service_role'):
                schema = schema.replace('CREATE ROLE ' + role + ';','')
            self.sql(schema)
            self.sql((ROOT / 'scripts/fixtures/settlement/external-schema.sql').read_text())
            source_schema = subprocess.check_output(['node','-e',"process.stdout.write(require('./scripts/fixtures/settlement/replacement-source-schema.cjs').sourceSchemaSql())"],cwd=ROOT,text=True,timeout=20)
            self.sql(source_schema)
            self.sql((ROOT / 'apps/mobile/supabase/migrations/20261111040111_settlement_runtime_v1.sql').read_text())
            self.sql((ROOT / 'scripts/fixtures/settlement/approved-policy.sql').read_text())
            self.sql("INSERT INTO dvnt_settlement.funding_policy VALUES(true,'acct_fixture',false,0,'synthetic race fixture'); INSERT INTO dvnt_settlement.currency_reserves VALUES('usd',0,'synthetic race fixture'); UPDATE dvnt_settlement.controls SET checkout_enabled=true,checkout_replacement_enabled=true,guest_checkout_recovery_enabled=true,replacement_cleanup_enabled=true; UPDATE events SET status='active',end_date=clock_timestamp()+interval '10 days',start_date=clock_timestamp()+interval '9 days',payout_release_at=NULL; INSERT INTO ticket_types(id,event_id,price_cents,quantity_total) VALUES('"+TIER+"',1,10000,20)")
            return self
        except BaseException:
            self.__exit__(None,None,None)
            raise

    def original(self, suffix, buyer='fixture-buyer', tier=TIER, guest=False, cart=False):
        snapshot={'rail':'create-payment-intent','selection':{'ticket_type_id':tier},'order':{
            'user_id':None if guest else buyer,'guest_email':'buyer@example.invalid' if guest else None,
            'event_id':1,'quantity':1,'currency':'usd','total_cents':10350,'subtotal_cents':10000,
            'organizer_fee_cents':350,'platform_fee_cents':700,'dvnt_total_fee_cents':700}}
        if cart:
            assert not guest
            cart_id,line_id=str(uuid.uuid4()),str(uuid.uuid4())
            self.sql('INSERT INTO carts(id,user_id,event_id,status,stripe_pi_id,idempotency_key) VALUES('+','.join(map(literal,[cart_id,buyer,1,'paying','pi_'+suffix,'fixture-cart-'+suffix]))+'); INSERT INTO cart_line_items(id,cart_id,category,tier_id,quantity,unit_price_cents) VALUES('+','.join(map(literal,[line_id,cart_id,'admission',tier,1,10000]))+')')
            snapshot['rail']='cart-checkout';snapshot['order']['cart_id']=cart_id
            snapshot['selection']={'lines':[{'id':line_id,'tier_id':tier,'addon_id':None,'variant_id':None,'quantity':1,'unit_price_cents':10000}]}
        order=self.rpc('prepare_settlement_checkout',p_snapshot=snapshot,p_request_key='fixture-original-'+suffix)['order_id']
        self.rpc('claim_settlement_checkout',p_order_id=order,p_params={'amount':'10350'})
        self.rpc('finalize_settlement_checkout',p_order_id=order,p_payment_intent_id='pi_'+suffix,p_checkout_session_id=None)
        return {'order':order,'buyer':None if guest else buyer,'guest':None,'intent':{'id':'pi_'+suffix,'object':'payment_intent','status':'canceled','amount':10350,'currency':'usd','amount_received':0,'amount_capturable':0,'latest_charge':None,'livemode':False,'transfer_data':None,'application_fee_amount':None,'on_behalf_of':None,'metadata':{'settlement_order_id':order,'charge_model':'separate_charges_and_transfers'},'canceled_at':1}}

    def quote(self, original):
        return self.rpc('settlement_replacement_quote',p_order_id=original['order'],p_actor_id=original['buyer'],p_guest_session_hash=original['guest'])

    def accept_sql(self, original, quote):
        return call('settlement_replacement_accept',p_quote_id=quote['quote_id'],p_actor_id=original['buyer'],p_guest_session_hash=original['guest'],p_accepted_total_cents=quote['total_cents'],p_accepted_currency=quote['currency'],p_intent=original['intent'],p_session=None,p_platform_account='acct_fixture',p_livemode=False,p_charges=[])

    def accepted(self, original):
        return json.loads(self.sql(self.accept_sql(original,self.quote(original))))

    def due(self, order):
        # Test-only clock fixture. No production mutation or release permission.
        self.sql("ALTER TABLE dvnt_settlement.replacement_cleanup DISABLE TRIGGER freeze_replacement_cleanup; UPDATE dvnt_settlement.replacement_cleanup SET due_at=clock_timestamp()-interval '2 hours',next_check_at=clock_timestamp()-interval '1 hour' WHERE order_id="+literal(order)+"; ALTER TABLE dvnt_settlement.replacement_cleanup ENABLE TRIGGER freeze_replacement_cleanup")


def successor_and_dispatch_are_unique():
    with Database() as db:
        original=db.original('unique'); quote=db.quote(original)
        before=db.sql('SELECT to_jsonb(o) FROM orders o WHERE id='+literal(original['order']))
        first=db.holding(db.accept_sql(original,quote))
        result=json.loads(db.competing(first, db.accept_sql(original,quote)));db.finish(first)
        assert db.sql('SELECT count(*) FROM dvnt_settlement.checkout_replacements')=='1'
        assert db.sql('SELECT to_jsonb(o) FROM orders o WHERE id='+literal(original['order']))==before
        dispatch=call('claim_settlement_checkout',p_order_id=result['order_id'],p_params={'amount':str(quote['total_cents'])})
        first=db.holding(dispatch);other=json.loads(db.competing(first, dispatch));db.finish(first)
        assert other['claimed'] is False
        assert db.sql("SELECT count(*) FROM dvnt_settlement.checkouts WHERE order_id="+literal(result['order_id'])+' AND attempted_at IS NOT NULL')=='1'


def last_stock_and_buyer_cap_serialize():
    with Database() as db:
        db.sql('UPDATE ticket_types SET quantity_total=1')
        a,b=db.original('stocka','buyer-a'),db.original('stockb','buyer-b')
        qa,qb=db.quote(a),db.quote(b)
        first=db.holding(db.accept_sql(a,qa));error=db.competing(first, db.accept_sql(b,qb),ok=False);db.finish(first)
        assert 'inventory' in error,error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.checkout_replacements')=='1'
        assert db.sql("SELECT sum(quantity) FROM ticket_holds WHERE status='active'")=='1'
    with Database() as db:
        originals=[]
        for n in range(3):
            tier=str(uuid.UUID(int=100+n))
            db.sql('INSERT INTO ticket_types(id,event_id,price_cents,quantity_total) VALUES('+literal(tier)+',1,10000,20)')
            originals.append(db.original('capped'+str(n),tier=tier))
        quotes=[db.quote(o) for o in originals]
        db.sql(db.accept_sql(originals[0],quotes[0]))
        first=db.holding(db.accept_sql(originals[1],quotes[1]));error=db.competing(first, db.accept_sql(originals[2],quotes[2]),ok=False);db.finish(first)
        assert 'inventory limit' in error,error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.checkout_replacements')=='2'


def late_financial_hold_blocks_accept_and_dispatch():
    with Database() as db:
        original=db.original('hold');quote=db.quote(original)
        first=db.holding(call('settlement_hold',p_order_id=original['order'],p_event_id='fixture-hold',p_reason='refund'))
        error=db.competing(first, db.accept_sql(original,quote),ok=False);db.finish(first)
        assert 'evidence blocks' in error,error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.checkout_replacements')=='0'
    with Database() as db:
        original=db.original('afteraccept');quote=db.quote(original)
        first=db.holding(db.accept_sql(original,quote))
        db.competing(first, call('settlement_hold',p_order_id=original['order'],p_event_id='fixture-late-hold',p_reason='refund'));db.finish(first)
        successor=db.sql('SELECT successor_order_id FROM dvnt_settlement.checkout_replacements')
        error=db.sql(call('claim_settlement_checkout',p_order_id=successor,p_params={'amount':'10350'}),ok=False)
        assert 'evidence blocks' in error,error
        assert db.sql('SELECT attempted_at IS NULL FROM dvnt_settlement.checkouts WHERE order_id='+literal(successor))=='t'


def guest_exchange_and_email_limit_are_atomic():
    with Database() as db:
        original=db.original('guest',guest=True)
        issue=lambda token: call('settlement_guest_recovery_issue',p_order_id=original['order'],p_email='buyer@example.invalid',p_capability_hash=token*64,p_email_hash='b'*64,p_ip_hash='d'*64)
        db.sql(issue('a'))
        first=db.holding(call('settlement_guest_recovery_exchange',p_capability_hash='a'*64,p_session_hash='c'*64,p_ip_hash='d'*64))
        other=json.loads(db.competing(first, call('settlement_guest_recovery_exchange',p_capability_hash='a'*64,p_session_hash='e'*64,p_ip_hash='d'*64)));db.finish(first)
        assert other['ok'] is False
        assert db.sql('SELECT count(*) FROM dvnt_settlement.guest_recovery_sessions')=='1'
        db.sql(issue('f'))
        first=db.holding(issue('1'));other=json.loads(db.competing(first, issue('2')));db.finish(first)
        assert other['issued'] is False
        assert db.sql('SELECT count(*) FROM dvnt_settlement.guest_recovery_capabilities')=='3'
        original['guest']='c'*64
        quote=db.quote(original)
        first=db.holding(db.accept_sql(original,quote));replay=json.loads(db.competing(first, db.accept_sql(original,quote)));db.finish(first)
        assert replay['original_order_id']==original['order']
        assert db.sql('SELECT count(*) FROM dvnt_settlement.checkout_replacements')=='1'
        assert db.sql('SELECT consumed_at IS NOT NULL FROM dvnt_settlement.guest_recovery_sessions')=='t'


def cleanup_never_dispatch_tombstone_races_claim():
    for cleanup_first in (True,False):
        with Database() as db:
            successor=db.accepted(db.original('cleanup'))['order_id'];db.due(successor)
            cleanup=call('settlement_replacement_cleanup_release',p_order_id=successor)
            dispatch=call('claim_settlement_checkout',p_order_id=successor,p_params={'amount':'10350'})
            first=db.holding(cleanup if cleanup_first else dispatch)
            error=db.competing(first, dispatch if cleanup_first else cleanup,ok=False);db.finish(first)
            assert 'deadlock' not in error.lower(),error
            if cleanup_first:
                assert 'permanently closed' in error or 'inventory' in error,error
                assert db.sql('SELECT attempted_at IS NULL FROM dvnt_settlement.checkouts WHERE order_id='+literal(successor))=='t'
                assert db.sql("SELECT state FROM dvnt_settlement.replacement_cleanup WHERE order_id="+literal(successor))=='not_dispatched'
            else:
                assert 'proof' in error or 'account' in error,error
                assert db.sql("SELECT status FROM ticket_holds WHERE payment_intent_id="+literal('replacement:'+successor))=='active'
                assert db.sql('SELECT dispatch_closed_at IS NULL FROM dvnt_settlement.replacement_cleanup WHERE order_id='+literal(successor))=='t'



def cart_lineage_and_paid_issuance_race_cleanup():
    with Database() as db:
        original=db.original('cartunique',cart=True);quote=db.quote(original)
        original_cart=db.sql('SELECT cart_id FROM orders WHERE id='+literal(original['order']))
        before=db.sql('SELECT to_jsonb(c) FROM carts c WHERE id='+literal(original_cart))
        first=db.holding(db.accept_sql(original,quote));result=json.loads(db.competing(first, db.accept_sql(original,quote)));db.finish(first)
        assert result['new_cart_id']!=original_cart
        assert db.sql('SELECT count(*) FROM dvnt_settlement.checkout_replacements')=='1'
        assert db.sql('SELECT to_jsonb(c) FROM carts c WHERE id='+literal(original_cart))==before
        assert 'immutable' in db.sql('UPDATE cart_line_items SET quantity=2 WHERE cart_id='+literal(result['new_cart_id']),ok=False)
        assert 'immutable' in db.sql('UPDATE carts SET user_id='+literal('other-buyer')+' WHERE id='+literal(result['new_cart_id']),ok=False)
    for fulfill_first in (True,False):
        with Database() as db:
            original=db.original('cartrace',cart=True);result=db.accepted(original);successor=result['order_id']
            db.rpc('claim_settlement_checkout',p_order_id=successor,p_params={'amount':'10350'})
            db.rpc('finalize_settlement_checkout',p_order_id=successor,p_payment_intent_id='pi_successor',p_checkout_session_id=None)
            db.due(successor)
            line=db.sql('SELECT id FROM cart_line_items WHERE cart_id='+literal(result['new_cart_id']))
            fulfill=call('complete_paid_cart_atomic',p_cart_id=result['new_cart_id'],p_payment_intent_id='pi_successor',p_amount_received=10350,p_currency='usd',p_user_id='fixture-buyer',p_event_id=1,p_ticket_rows=[{'ticket_id':str(uuid.uuid4()),'line_item_id':line,'qr_token':'fixture-qr','qr_payload':'fixture-payload'}],p_addon_rows=[])
            canceled={**original['intent'],'id':'pi_successor','metadata':{**original['intent']['metadata'],'settlement_order_id':successor}}
            release=call('settlement_replacement_cleanup_release',p_order_id=successor,p_intent=canceled,p_session=None,p_platform_account='acct_fixture',p_livemode=False,p_charges=[])
            # Contradictory synthetic evidence intentionally races: whichever
            # exact terminal transaction commits first prevents the other from
            # consuming/releasing the same inventory or rewriting its history.
            first=db.holding(fulfill if fulfill_first else release)
            error=db.competing(first, release if fulfill_first else fulfill,ok=False);db.finish(first)
            assert 'deadlock' not in error.lower(),error
            if fulfill_first:
                assert 'evidence blocks' in error,error
                assert db.sql('SELECT count(*) FROM tickets WHERE order_id='+literal(successor))=='1'
                assert db.sql("SELECT count(*) FROM dvnt_settlement.replacement_inventory_releases WHERE order_id="+literal(successor)+" AND reason='canceled'")=='0'
            else:
                assert 'proof mismatch' in error,error
                assert db.sql('SELECT count(*) FROM tickets WHERE order_id='+literal(successor))=='0'
                assert db.sql("SELECT count(*) FROM dvnt_settlement.replacement_inventory_releases WHERE order_id="+literal(successor)+" AND reason='fulfilled'")=='0'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--disposable-ci-postgres',action='store_true');args=parser.parse_args()
    if not args.disposable_ci_postgres or os.getenv('GITHUB_ACTIONS')!='true':
        parser.error('Requires explicitly selected disposable GitHub Actions PostgreSQL runner.')
    for key in list(os.environ):
        if key.startswith('PG'):del os.environ[key]
    roles="DO $$ BEGIN "+' '.join("IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='"+r+"') THEN CREATE ROLE "+r+"; END IF;" for r in ('anon','authenticated','service_role'))+" END $$;"
    subprocess.run(PREFIX+['psql','-X','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-d','postgres'],input=roles,text=True,check=True,timeout=20)
    for test in (successor_and_dispatch_are_unique,last_stock_and_buyer_cap_serialize,late_financial_hold_blocks_accept_and_dispatch,guest_exchange_and_email_limit_are_atomic,cleanup_never_dispatch_tombstone_races_claim,cart_lineage_and_paid_issuance_race_cleanup):
        test();print('PASS',test.__name__,flush=True)

if __name__=='__main__':main()
