const {test}=require('node:test');const assert=require('node:assert/strict');
const {fixture,rpc,TIER}=require('./fixtures/settlement/replacement-db.cjs');
test('replacement quote is fresh, explicitly accepted, idempotent, and preserves original immutable evidence',async()=>{const f=await fixture();try{
 const before=(await f.db.query('select * from orders')).rows[0];await f.db.exec('update ticket_types set price_cents=12000');const q=await f.quote();assert.equal(q.total_cents,12400);
 await assert.rejects(f.accept(q,{p_accepted_total_cents:10350}),/acceptance mismatch/);
 const p=await f.accept(q);assert.notEqual(p.order_id,f.original.order_id);assert.deepEqual(await f.accept(q),p);
 assert.deepEqual((await f.db.query('select * from orders where id=$1',[f.original.order_id])).rows[0],before);
 assert.equal((await f.db.query('select count(*)::int n from dvnt_settlement.checkout_replacements')).rows[0].n,1);
 assert.doesNotMatch(JSON.stringify((await f.db.query('select proof from dvnt_settlement.checkout_replacements')).rows),/NEVER_PERSIST|client_secret/);
 assert.equal((await f.db.query('select payment_intent_id from ticket_holds')).rows[0].payment_intent_id,'replacement:'+p.order_id);
 assert.equal((await rpc(f.db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:String(q.total_cents)}})).claimed,true);
 assert.equal((await rpc(f.db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:String(q.total_cents)}})).claimed,false);
 await rpc(f.db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_successor',p_checkout_session_id:null});
 assert.equal((await f.db.query('select payment_intent_id from ticket_holds')).rows[0].payment_intent_id,'pi_successor');
 }finally{await f.db.close();}});

test('replacement owner/guest crossover, roles and default gate fail closed',async()=>{const f=await fixture();try{
 for(const p_actor_id of [null,'another-buyer'])await assert.rejects(rpc(f.db,'settlement_replacement_context',{p_order_id:f.original.order_id,p_actor_id}),/unavailable/);
 await assert.rejects(rpc(f.db,'settlement_replacement_context',{p_order_id:f.original.order_id,p_actor_id:'fixture-buyer',p_guest_session_hash:'c'.repeat(64)}),/unavailable/);
 await f.db.exec('UPDATE dvnt_settlement.controls SET checkout_replacement_enabled=false');await assert.rejects(f.quote(),/disabled/);
 for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);await assert.rejects(f.quote(),/permission/);await f.db.exec('reset role');}
 }finally{await f.db.close();}});

test('both hosted rails require exact expired unpaid session and support verified guest session consumption',async()=>{for(const rail of ['ticket-checkout','guest-checkout']){const f=await fixture({rail,guest:rail==='guest-checkout'});try{
 const q=await f.quote();assert.equal(q.tax_mode,rail==='ticket-checkout'?'at_checkout':'none');
 await assert.rejects(f.accept(q,{p_session:{...f.session,status:'open'}}),/hosted proof/);
 const p=await f.accept(q);assert.deepEqual(await f.accept(q),p);
 if(rail==='guest-checkout'){assert.ok((await f.db.query('select consumed_at from dvnt_settlement.guest_recovery_sessions')).rows[0].consumed_at);await assert.rejects(f.quote(),/unavailable/);}
 await rpc(f.db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{mode:'payment',expires_at:String(Math.floor(new Date(p.created_at).getTime()/1000)+3500)}});
 await rpc(f.db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_successor',p_checkout_session_id:'cs_successor'});
 assert.equal((await f.db.query('select payment_intent_id from ticket_holds')).rows[0].payment_intent_id,'cs_successor');
 }finally{await f.db.close();}}});

test('cart replacement preserves original cart/order/lines/PI and renews inventory only on new revision',async()=>{const f=await fixture({cart:true});try{
 const oldCart=(await f.db.query('select * from carts')).rows[0];const oldLines=(await f.db.query('select * from cart_line_items')).rows;
 await f.db.exec(`insert into cart_holds(cart_id,line_item_id,tier_id,qty,expires_at) values('${oldCart.id}','${oldLines[0].id}','${TIER}',1,now()+interval '1 hour')`);
 const q1=await f.quote();assert.equal((await f.quote()).quote_id,q1.quote_id);await f.db.exec('update ticket_types set price_cents=11000');const q2=await f.quote();await f.db.exec('update ticket_types set price_cents=10000');const p=await f.accept(q1);await assert.rejects(f.accept(q2),/already authorized/);
 assert.notEqual(p.new_cart_id,oldCart.id);assert.deepEqual((await f.db.query('select * from carts where id=$1',[oldCart.id])).rows[0],oldCart);
 assert.deepEqual((await f.db.query('select * from cart_line_items where cart_id=$1',[oldCart.id])).rows,oldLines);
 assert.equal((await f.db.query('select released from cart_holds where cart_id=$1',[oldCart.id])).rows[0].released,true);
 assert.equal((await f.db.query('select released from cart_holds where cart_id=$1',[p.new_cart_id])).rows[0].released,false);
 assert.equal((await f.db.query('select count(distinct cart_id)::int n from orders')).rows[0].n,2);
 await rpc(f.db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:String(q1.total_cents)}});
 await rpc(f.db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_successor',p_checkout_session_id:null});
 assert.equal((await f.db.query('select stripe_pi_id from carts where id=$1',[p.new_cart_id])).rows[0].stripe_pi_id,'pi_successor');
 assert.equal((await f.db.query('select stripe_pi_id from carts where id=$1',[oldCart.id])).rows[0].stripe_pi_id,'pi_fixture');
 }finally{await f.db.close();}});

test('changed prices, exhausted stock, sale closure and uncertain proof never create successor or release original inventory',async()=>{const f=await fixture();try{
 const q=await f.quote();await f.db.exec('update ticket_types set price_cents=12000');await assert.rejects(f.accept(q),/quote changed/);await f.db.exec('update ticket_types set price_cents=10000,quantity_total=0');await assert.rejects(f.accept(q),/inventory/);
 await f.db.exec('update ticket_types set quantity_total=20');
 for(const patch of [{status:'processing'},{amount_received:1},{latest_charge:'ch_prior'},{amount_capturable:1},{currency:'eur'},{livemode:true},{canceled_at:null},{transfer_data:{}},{id:'pi_other'}])await assert.rejects(f.accept(q,{p_intent:{...f.intent,...patch}}),/proof invalid/);
 await assert.rejects(f.accept(q,{p_platform_account:'acct_other'}),/account/);await assert.rejects(f.accept(q,{p_charges:[{id:'ch_prior'}]}),/charge evidence/);
 await f.db.exec("update ticket_types set sale_end=now()-interval '1 second'");await assert.rejects(f.accept(q),/tier unavailable/);
 assert.equal((await f.db.query('select count(*)::int n from orders')).rows[0].n,1);assert.equal((await f.db.query('select count(*)::int n from ticket_holds')).rows[0].n,0);
 }finally{await f.db.close();}});

test('late financial/fulfillment evidence blocks acceptance even after quote',async()=>{for(const evidence of ['hold','ticket','refund_outflow','dispute','external']){const f=await fixture();try{
 const q=await f.quote();
 if(evidence==='hold')await rpc(f.db,'settlement_hold',{p_order_id:f.original.order_id,p_event_id:'manual_fixture',p_reason:'manual'});
 if(evidence==='ticket')await f.db.query('insert into tickets(order_id,ticket_type_id,status) values($1,$2,$3)',[f.original.order_id,TIER,'refunded']);
 if(evidence==='refund_outflow')await f.db.query("insert into dvnt_settlement.refund_outflows(order_id,request_key,request_body,currency,amount_cents,state) values($1,'fixture','{}','usd',1,'canceled')",[f.original.order_id]);
 if(evidence==='dispute')await f.db.query("insert into dvnt_settlement.dispute_outflows(order_id,currency,amount_cents) values($1,'usd',1)",[f.original.order_id]);
 if(evidence==='external')await f.db.exec('insert into dvnt_settlement.legacy_execution_claims(event_id) values(1)');
 await assert.rejects(f.accept(q),/evidence blocks/);assert.equal((await f.db.query('select count(*)::int n from dvnt_settlement.checkout_replacements')).rows[0].n,0);
 }finally{await f.db.close();}}});


test('unknown replacement inventory survives timeout and legacy failure cleanup until actual paid cart fulfillment',async()=>{const f=await fixture({cart:true});try{
 const q=await f.quote(),p=await f.accept(q);await rpc(f.db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:String(q.total_cents)}});
 await rpc(f.db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_successor',p_checkout_session_id:null});
 await f.db.query("update cart_holds set released=true,released_at=now(),expires_at=now()-interval '1 hour' where cart_id=$1",[p.new_cart_id]);
 let holds=(await f.db.query("select released,expires_at='infinity'::timestamptz retained from cart_holds where cart_id=$1",[p.new_cart_id])).rows;assert.deepEqual(holds,[{released:false,retained:true}]);
 const line=(await f.db.query('select id from cart_line_items where cart_id=$1',[p.new_cart_id])).rows[0].id;
 const args={p_cart_id:p.new_cart_id,p_payment_intent_id:'pi_successor',p_amount_received:q.total_cents,p_currency:'usd',p_user_id:'fixture-buyer',p_event_id:1,p_ticket_rows:[],p_addon_rows:[]};
 await assert.rejects(rpc(f.db,'complete_paid_cart_atomic',args),/inventory incomplete/);
 assert.equal((await f.db.query('select count(*)::int n from dvnt_settlement.replacement_inventory_releases where order_id=$1',[p.order_id])).rows[0].n,0);
 const paid=await rpc(f.db,'complete_paid_cart_atomic',{...args,p_ticket_rows:[{ticket_id:'00000000-0000-4000-8000-000000000099',line_item_id:line,qr_token:'fixture-qr',qr_payload:'fixture-payload'}]});assert.equal(paid.ok,true);
 assert.equal((await f.db.query('select status from orders where id=$1',[p.order_id])).rows[0].status,'paid');
 holds=(await f.db.query('select released from cart_holds where cart_id=$1',[p.new_cart_id])).rows;assert.ok(holds.every(h=>h.released));
 assert.equal((await rpc(f.db,'settlement_replacement_dispatch_context',{p_order_id:p.order_id})).checkout_available,false);
 }finally{await f.db.close();}});

test('direct replacement holds cannot expire or be deleted while a client secret or unknown dispatch may still pay',async()=>{const f=await fixture();try{
 const q=await f.quote(),p=await f.accept(q);await rpc(f.db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:String(q.total_cents)}});
 await rpc(f.db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_successor',p_checkout_session_id:null});
 await f.db.exec("update ticket_holds set status='expired',expires_at=now()-interval '1 hour'");
 assert.deepEqual((await f.db.query("select status,expires_at='infinity'::timestamptz retained from ticket_holds")).rows,[{status:'active',retained:true}]);
 await assert.rejects(f.db.exec('delete from ticket_holds'),/history is immutable/);
 await assert.rejects(f.db.exec('update ticket_holds set quantity=2'),/identity is immutable/);
 assert.equal((await rpc(f.db,'settlement_replacement_dispatch_context',{p_order_id:p.order_id})).checkout_available,true);
 }finally{await f.db.close();}});

test('fresh same-order guest recovery resumes only the existing accepted successor after reload',async()=>{const f=await fixture({rail:'guest-checkout',guest:true});try{
 const q=await f.quote(),p=await f.accept(q);
 await rpc(f.db,'settlement_guest_recovery_issue',{p_order_id:f.original.order_id,p_email:'buyer@example.invalid',p_capability_hash:'e'.repeat(64),p_email_hash:'b'.repeat(64),p_ip_hash:'d'.repeat(64)});
 await rpc(f.db,'settlement_guest_recovery_exchange',{p_capability_hash:'e'.repeat(64),p_session_hash:'f'.repeat(64),p_ip_hash:'d'.repeat(64)});
 const auth={p_actor_id:null,p_guest_session_hash:'f'.repeat(64)};
 const context=await rpc(f.db,'settlement_replacement_context',{p_order_id:f.original.order_id,...auth});assert.equal(context.accepted_quote.quote_id,q.quote_id);
 const resumed=await rpc(f.db,'settlement_replacement_quote',{p_order_id:f.original.order_id,...auth});assert.equal(resumed.resume_only,true);assert.equal(resumed.quote_id,q.quote_id);
 assert.deepEqual(await f.accept(q,auth),p);assert.deepEqual(await f.accept(q,auth),p);
 assert.equal((await f.db.query('select count(*)::int n from dvnt_settlement.checkout_replacements')).rows[0].n,1);
 await f.db.exec("update dvnt_settlement.guest_recovery_sessions set expires_at=now()-interval '1 second'");
 await assert.rejects(f.accept(q,auth),/unavailable/);
 }finally{await f.db.close();}});

test('accepted cart selections stay immutable but legitimate refund counters remain writable',async()=>{const f=await fixture({cart:true});try{
 const p=await f.accept(await f.quote());await assert.rejects(f.db.query('update cart_line_items set quantity=2 where cart_id=$1',[p.new_cart_id]),/immutable/);
 await assert.rejects(f.db.query('delete from cart_line_items where cart_id=$1',[p.new_cart_id]),/immutable/);
 await f.db.query('update cart_line_items set refunded_amount_cents=1 where cart_id=$1',[p.new_cart_id]);
 assert.equal((await f.db.query('select refunded_amount_cents from cart_line_items where cart_id=$1',[p.new_cart_id])).rows[0].refunded_amount_cents,1);
 }finally{await f.db.close();}});

test('current cart add-on variant pricing, parent inventory and immutable lineage are preserved',async()=>{const f=await fixture({cart:true,addon:true});try{
 await f.db.exec('update ticket_addon_variants set price_cents=1700');const q=await f.quote();assert.equal(q.total_cents,12193);
 const p=await f.accept(q);const lines=(await f.db.query('select tier_id,addon_id,variant_id,unit_price_cents from cart_line_items where cart_id=$1 order by addon_id nulls first',[p.new_cart_id])).rows;
 assert.equal(lines.length,2);assert.equal(lines[1].unit_price_cents,1700);assert.equal(lines[1].variant_id,'00000000-0000-4000-8000-000000000041');
 assert.equal((await f.db.query("select addon_available('00000000-0000-4000-8000-000000000040') n")).rows[0].n,0);
 assert.equal((await f.db.query('select count(*)::int n from dvnt_settlement.checkout_replacements r cross join lateral jsonb_object_keys(r.line_map) k')).rows[0].n,2);
 }finally{await f.db.close();}});

test('buyer-wide cap bounds unknown replacement reservations across distinct selections',async()=>{const f=await fixture();try{
 await f.accept(await f.quote());const tier2='00000000-0000-4000-8000-000000000011';await f.db.query('insert into ticket_types(id,event_id,price_cents,quantity_total) values($1,1,10000,20)',[tier2]);
 const snap=structuredClone(f.snapshot);snap.selection.ticket_type_id=tier2;
 const old=await rpc(f.db,'prepare_settlement_checkout',{p_snapshot:snap,p_request_key:'fixture-second-original'});
 await rpc(f.db,'claim_settlement_checkout',{p_order_id:old.order_id,p_params:{amount:'10350'}});await rpc(f.db,'finalize_settlement_checkout',{p_order_id:old.order_id,p_payment_intent_id:'pi_second',p_checkout_session_id:null});
 const q=await rpc(f.db,'settlement_replacement_quote',{p_order_id:old.order_id,...f.auth});
 const accept=()=>f.accept(q,{p_intent:{...f.intent,id:'pi_second',metadata:{...f.intent.metadata,settlement_order_id:old.order_id}}});
 await f.db.exec('update dvnt_settlement.controls set max_active_replacement_units=1');await assert.rejects(accept(),/unit limit/);
 await f.db.exec('update dvnt_settlement.controls set max_active_replacement_units=40,max_active_replacements=1');await assert.rejects(accept(),/inventory limit/);
 await f.db.exec('update dvnt_settlement.controls set max_active_replacements=2');await accept();
 assert.equal((await f.db.query('select count(*)::int n from dvnt_settlement.checkout_replacements')).rows[0].n,2);
 }finally{await f.db.close();}});

test('real paid single-tier issuance converts a retained replacement hold without duplicate credentials',async()=>{const f=await fixture();try{
 const q=await f.quote(),p=await f.accept(q);await rpc(f.db,'claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:String(q.total_cents)}});
 await rpc(f.db,'finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_successor',p_checkout_session_id:null});
 const args={p_order_id:p.order_id,p_ticket_type_id:TIER,p_payment_intent_id:'pi_successor',p_checkout_session_id:null,p_amount_cents:q.total_cents,p_ticket_rows:[{id:'00000000-0000-4000-8000-000000000099',event_id:1,ticket_type_id:TIER,user_id:'fixture-buyer',order_id:p.order_id,stripe_payment_intent_id:'pi_successor',qr_token:'fixture-qr',qr_payload:'fixture-payload',purchase_amount_cents:q.total_cents}]};
 const paid=await rpc(f.db,'paid_ticket_issuance_atomic',args);assert.equal(paid.ok,true,JSON.stringify(paid));assert.equal((await f.db.query('select status from ticket_holds')).rows[0].status,'converted');
 const replay=await rpc(f.db,'paid_ticket_issuance_atomic',args);assert.equal(replay.duplicate,true);assert.equal((await f.db.query('select count(*)::int n from tickets')).rows[0].n,1);
 }finally{await f.db.close();}});

test('absorb economics remain blocked pending coherent shared ledger policy',async()=>{const f=await fixture();try{await f.db.exec("update events set fee_mode='absorb'");await assert.rejects(f.quote(),/absorb fee policy requires review/);assert.equal((await f.db.query('select count(*)::int n from dvnt_settlement.checkout_replacements')).rows[0].n,0);}finally{await f.db.close();}});


test('canonical active event may replace while draft/postponed/suspended/cancelled/unknown events fail closed',async()=>{const f=await fixture();try{assert.equal((await f.db.query('SELECT status FROM events')).rows[0].status,'active');assert.ok((await f.quote()).quote_id);for(const status of ['draft','postponed','suspended','cancelled','published','live','unknown']){await f.db.query('UPDATE events SET status=$1',[status]);await assert.rejects(f.quote(),/event unavailable/);}}finally{await f.db.close();}});


test('priced original cart snapshots retain old prices while successor selection binds accepted fresh line prices',async()=>{for(const includePrices of [false,true]){const f=await fixture({cart:true,addon:true,includePrices});try{await f.db.exec('UPDATE ticket_types SET price_cents=12000; UPDATE ticket_addon_variants SET price_cents=1700');const q=await f.quote(),p=await f.accept(q);const lines=(await f.db.query('SELECT snapshot FROM dvnt_settlement.checkouts WHERE order_id=$1',[p.order_id])).rows[0].snapshot.selection.lines;assert.deepEqual(lines.map(l=>l.unit_price_cents).sort((a,b)=>a-b),[1700,12000]);const old=(await f.db.query('SELECT snapshot FROM dvnt_settlement.checkouts WHERE order_id=$1',[f.original.order_id])).rows[0].snapshot.selection.lines;assert.deepEqual(old,f.snapshot.selection.lines);}finally{await f.db.close();}}});
test('priced original cart line mismatch cannot be silently converted into a fresh successor',async()=>{const f=await fixture({cart:true,includePrices:true});try{await f.db.exec('UPDATE cart_line_items SET unit_price_cents=9000');await assert.rejects(f.quote(),/cart selection changed/);assert.equal((await f.db.query('SELECT count(*)::int n FROM dvnt_settlement.checkout_replacements')).rows[0].n,0);}finally{await f.db.close();}});
