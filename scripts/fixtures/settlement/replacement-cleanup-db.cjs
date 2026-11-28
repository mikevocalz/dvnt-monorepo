// Shared offline cleanup fixture: real SQL and synthetic provider only.
const assert=require('node:assert/strict');
const {fixture,rpc}=require('./replacement-db.cjs');
async function setup({rail='create-payment-intent',dispatch=true,finalize=true,cart=false,ageHours=2}={}){
 const f=await fixture({rail,cart});
 // Synthetic elapsed time only: production's insert trigger still creates the
 // cleanup row. No fulfillment, cancellation, or provider evidence is seeded.
 assert.ok(Number.isFinite(ageHours)&&ageHours>=0);
 await f.db.exec(`CREATE FUNCTION public.fixture_cleanup_clock() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN NEW.due_at:=NEW.due_at-interval '${ageHours} hours'; NEW.next_check_at:=NEW.next_check_at-interval '${ageHours} hours'; RETURN NEW; END $$;
 CREATE TRIGGER fixture_cleanup_clock BEFORE INSERT ON dvnt_settlement.replacement_cleanup FOR EACH ROW EXECUTE FUNCTION public.fixture_cleanup_clock();`);
 const p=await f.accept(await f.quote());const id=p.order_id||p.successor_order_id;
 await f.db.exec('DROP TRIGGER fixture_cleanup_clock ON dvnt_settlement.replacement_cleanup; DROP FUNCTION public.fixture_cleanup_clock();');
 assert.ok(id,JSON.stringify(p));
 if(dispatch){await rpc(f.db,'claim_settlement_checkout',{p_order_id:id,p_params:{expires_at:Math.floor(Date.now()/1000)+1800}});if(finalize)await rpc(f.db,'finalize_settlement_checkout',{p_order_id:id,p_payment_intent_id:'pi_successor',p_checkout_session_id:['ticket-checkout','guest-checkout'].includes(rail)?'cs_successor':null});}
 await f.db.query("update dvnt_settlement.checkouts set created_at=now()-($2::text||' hours')::interval where order_id=$1",[id,ageHours]);
 // The generated artifact already includes cleanup before fulfillment. Never reinstall a wrapper over its outer gate.
 assert.ok((await f.db.query("SELECT to_regclass('dvnt_settlement.replacement_cleanup') v")).rows[0].v);
 await f.db.exec('update dvnt_settlement.controls set replacement_cleanup_enabled=true');
 const adapter={rpc:async(n,a)=>{try{return{data:await rpc(f.db,n,a),error:null}}catch(error){return{data:null,error}}}};
 const intent={...f.intent,id:'pi_successor',status:'requires_payment_method',canceled_at:null,metadata:{...f.intent.metadata,settlement_order_id:id}};
 const session=f.session?{...f.session,id:'cs_successor',status:'open',payment_intent:intent.id,metadata:intent.metadata}:null;
 const provider={posts:0,reads:0,lose:false,execute:true,async get(p){this.reads++;if(p==='/v1/account')return{object:'account',id:'acct_fixture'};if(p.startsWith('/v1/charges?'))return{object:'list',has_more:false,data:[]};if(p.startsWith('/v1/checkout/'))return session;if(p.startsWith('/v1/payment_intents/'))return intent;throw Error('unexpected read');},async post(p,b,k){this.posts++;assert.equal(k,'dvnt:replacement-cleanup:v1:'+id);if(this.execute){intent.status='canceled';intent.canceled_at=1;if(session)session.status='expired';}if(this.lose)throw Error('response lost');return{};}};
 return{...f,id,adapter,intent,session,provider,async held(){return +(await f.db.query("select count(*) n from ticket_holds where payment_intent_id in($1,$2,$3) and status='active'",['pi_successor','replacement:'+id,'cs_successor'])).rows[0].n;}};
}

module.exports={setup};
