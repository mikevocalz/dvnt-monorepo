const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(file,'utf8');
  const result = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  const module={exports:{}};
  const relativeRequire=(name)=>{
    assert.ok(name.startsWith('.'),'No network or third-party modules in handler tests');
    const target=path.resolve(path.dirname(file),name);
    return load(path.extname(target)?target:target+'.ts');
  };
  new Function('exports','module','require',result.outputText)(module.exports,module,relativeRequire);
  cache.set(file,module.exports); return module.exports;
}
const {createTicketEmbedHandler,embedHash,stripeEmbedParameters}=load(path.join(__dirname,'../_shared/ticket-embed-commerce.ts'));
const {computeFeesWithMode}=load(path.join(__dirname,'../_shared/fee-calculator.ts'));
const {renderTicketEmbedWidget}=load(path.join(__dirname,'../../../../../packages/app/lib/ticket-embed/widget.ts'));
const EMBED='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TIER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROMOTER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORIGIN='https://events.example.com';
const buyer={tierId:TIER,quantity:1,email:'test@example.com',name:'Test Guest',attendeeNames:[],promoterCode:''};
function harness(options={}) {
  let clock=Date.parse('2026-10-11T12:00:00Z');
  const log=[], sessions=new Map(), stripeKeys=new Map();
  const faults={...options.faults};
  const tables={
    events:[{id:90,host_id:'owner',title:'DVNT fixture',visibility:'public',status:'active',ticketing_enabled:true,
      start_date:'2026-10-12T12:00:00Z',end_date:'2026-10-12T18:00:00Z',fee_mode:'pass',attendee_name_requirement:'optional',...options.event}],
    ticket_types:[{id:TIER,event_id:90,name:'Admission',price_cents:2500,is_active:true,status:'on_sale',tier_visibility:'public',quantity_total:20,quantity_sold:0,max_per_user:10,...options.tier}],
    event_ticket_embed_settings:[{id:EMBED,event_id:90,allowed_origin:ORIGIN,revision:2,status:'published',...options.setting}],
    organizer_accounts:[{host_id:'owner',stripe_account_id:'acct_fixture',charges_enabled:true,...options.organizer}],
    event_promoters:[{id:PROMOTER,event_id:90,code:'TRE_1',customer_discount_bps:1000,promoter_commission_bps:2000,status:'active'}],
    ticket_embed_checkout_attempts:[],orders:[],ticket_holds:[],tickets:[],
  };
  const copy=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
  const db={from(table){
    assert.ok(table in tables,`Unexpected table ${table}`);
    let filters=[],patch=null,columns='*';
    const query={
      select(c){columns=c;return query;},
      eq(k,v){filters.push(r=>r[k]===v);return query;},
      in(k,values){filters.push(r=>values.includes(r[k]));return query;},
      ilike(k,v){filters.push(r=>String(r[k]).toUpperCase()===v.replace(/\\([%_\\])/g,'$1').toUpperCase());return query;},
      update(value){patch=value;return query;},
      async maybeSingle(){const result=await execute();return {...result,data:result.data?.[0]??null};},
      then(resolve,reject){return execute().then(resolve,reject);},
    };
    async function execute(){
      log.push(`${patch?'update':'select'}:${table}`);
      if(faults.table===table)return {data:null,error:{message:'private database failure'}};
      const rows=tables[table].filter(row=>filters.every(f=>f(row)));
      if(patch)rows.forEach(row=>Object.assign(row,patch));
      return {data:copy(rows.map(row=>columns==='*'?row:Object.fromEntries(columns.split(',').map(key=>key.trim()).map(key=>[key,row[key]])))),error:null};
    }
    return query;
  },async rpc(name,args){
    log.push(`rpc:${name}`);
    if(name==='check_rate_limit')return {data:!faults.limited,error:null};
    if(name==='record_rate_limit')return {data:null,error:null};
    if(faults[name])return {data:null,error:{message:faults[name]}};
    if(name==='ticket_embed_prepare_checkout'){
      const found=tables.ticket_embed_checkout_attempts.find(a=>a.id===args.p_id);
      if(found)return {data:copy(found),error:null};
      const order={id:randomUUID(),status:'payment_pending',ticket_email_status:'pending'};
      const hold={id:randomUUID(),status:'active'};
      tables.orders.push(order);tables.ticket_holds.push(hold);
      const a={id:args.p_id,embed_id:args.p_embed_id,origin:args.p_origin,proof_hash:args.p_proof_hash,request_hash:args.p_request_hash,
        state:'pending',quote:args.p_quote,order_id:order.id,hold_id:hold.id,created_at:new Date(clock).toISOString(),expires_at:new Date(args.p_quote.expiresAt*1000).toISOString(),stripe_session_id:null};
      tables.ticket_embed_checkout_attempts.push(a);return {data:copy(a),error:null};
    }
    if(name==='ticket_embed_cancel_unattached'){
      const a=tables.ticket_embed_checkout_attempts.find(a=>a.id===args.p_id);
      if(!a.stripe_session_id){a.state='cancelled';tables.ticket_holds.find(h=>h.id===a.hold_id).status='released';tables.orders.find(o=>o.id===a.order_id).status='payment_failed';}
      return {data:copy(a),error:null};
    }
    if(name==='ticket_embed_attach_session'){
      const a=tables.ticket_embed_checkout_attempts.find(a=>a.id===args.p_id);a.stripe_session_id=args.p_session;
      tables.orders.find(o=>o.id===a.order_id).stripe_checkout_session_id=args.p_session;
      tables.ticket_holds.find(h=>h.id===a.hold_id).payment_intent_id=args.p_session;
      return {data:copy(a),error:null};
    }
    throw Error(`Unexpected RPC ${name}`);
  }};
  const handler=createTicketEmbedHandler({db,enabled:options.enabled!==false,publishableKey:'pk_test_fixture',livemode:false,siteOrigin:'https://dvntapp.live',now:()=>clock,
    stripe:async(method,url,params,key)=>{
      log.push(`stripe:${method}:${url}`);
      if(faults.stripe)throw Error('Do not leak provider errors');
      if(url==='/checkout/sessions'){
        assert.equal(method,'POST');assert.ok(key);assert.ok(tables.orders.length);assert.ok(tables.ticket_holds.length);
        if(!stripeKeys.has(key)){
          const session={id:`cs_test_${sessions.size+1}`,client_secret:`fixture_secret_${sessions.size+1}`,status:'open',payment_status:'unpaid',currency:'usd',livemode:false,
            metadata:{embed_attempt_id:params['metadata[embed_attempt_id]']},client_reference_id:params.client_reference_id,
            amount_total:Number(params['line_items[0][price_data][unit_amount]'])+Number(params['line_items[1][price_data][unit_amount]']||0)};
          sessions.set(session.id,session);stripeKeys.set(key,{session,params});
        }
        const entry=stripeKeys.get(key);
        assert.deepEqual(entry.params,params,'Retries preserve all provider parameters');
        if(faults.lostResponse){faults.lostResponse=false;throw Error('lost response after Stripe creation');}
        return copy(entry.session);
      }
      const id=url.split('/')[3],session=sessions.get(id);assert.ok(session,`Missing session ${id}`);
      if(url.endsWith('/expire')){
        if(faults.expire)throw Error('Timeout while expiring provider session');
        if(session.status==='open')session.status='expired';
      }
      return copy(session);
    }});
  const identity={attemptId:randomUUID(),token:'d'.repeat(64)};
  async function call(action,body={},origin=ORIGIN){
    const response=await handler(new Request('https://fixture.invalid/ticket-embed',{method:'POST',headers:{Origin:origin},body:JSON.stringify({embedId:EMBED,action,...body})}));
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  async function open(changes={}){
    const q=await call('quote',{...buyer,...changes});assert.equal(q.status,200,JSON.stringify(q.body));
    const payload={...buyer,...changes,...identity,quoteHash:q.body.quoteHash};
    return {q,payload,result:await call('checkout',payload)};
  }
  return {call,open,tables,identity,log,sessions,stripeKeys,faults,advance:(ms)=>{clock+=ms;}};
}
test('disabled embed touches no Stripe or database state',async()=>{
  const h=harness({enabled:false});assert.equal((await h.call('describe')).status,404);assert.equal(h.log.length,0);
});
test('public descriptor omits account/guest fields and unavailable tiers',async()=>{
  const h=harness();h.tables.ticket_types.push({...h.tables.ticket_types[0],id:randomUUID(),tier_visibility:'hidden'});
  const r=await h.call('describe');assert.equal(r.status,200);assert.equal(r.body.tiers.length,1);
  assert.equal(r.body.event.host_id,undefined);assert.equal(JSON.stringify(r.body).includes('acct_fixture'),false);assert.equal(h.sessions.size,0);
});
for(const event of [{visibility:'private'},{visibility:'link_only'},{status:'draft'},{status:'deleted'},{status:'cancelled'}, {status:'unknown'}, {is_hidden:true},{publish_at:'2099-01-01'}, {ticketing_enabled:false},{start_date:null,end_date:null}]){
  test('unavailable event fails closed: '+JSON.stringify(event),async()=>{
    const h=harness({event});assert.equal((await h.call('describe')).status,404);assert.equal(h.sessions.size,0);
  });
}
test('foreign and missing origins cannot quote or reserve tickets',async()=>{
  for(const origin of ['https://evil.example.com','null','',ORIGIN+'.evil.com']){
    const h=harness();const r=await h.call('quote',buyer,origin);assert.equal(r.status,403);assert.equal(h.tables.orders.length,0);assert.equal(h.sessions.size,0);
  }
});
for(const changes of [{quantity:0},{quantity:1.5},{quantity:11},{quantity:'1'},{email:'bad'}, {tierId:'../../orders'}, {name:''}, {attendeeNames:['a'.repeat(41)]}, {addons:[{}]}, {promo_code:'SAVE'}]){
  test('invalid input cannot start commerce: '+JSON.stringify(changes),async()=>{
    const h=harness();const r=await h.call('quote',{...buyer,...changes});assert.equal(r.status,400);assert.equal(h.tables.orders.length,0);
  });
}
test('quote uses canonical pass fees without holds or Stripe calls',async()=>{
  const h=harness();const r=await h.call('quote',buyer);const f=computeFeesWithMode(2500,1,'pass');
  assert.equal(r.status,200);assert.equal(r.body.totals.total,f.customer_charge_amount);assert.equal(r.body.totals.serviceFee,f.buyer_fee);
  assert.match(r.body.quoteHash,/^[a-f0-9]{64}$/);assert.equal(h.tables.ticket_holds.length,0);assert.equal(h.sessions.size,0);
});
test('absorb fees and multi-ticket discounted subtotal stay canonical',async()=>{
  const h=harness({event:{fee_mode:'absorb'}});const {result}=await h.open({quantity:3,promoterCode:'Tre_1'});
  assert.equal(result.status,200);const q=h.tables.ticket_embed_checkout_attempts[0].quote;
  assert.equal(q.fees.subtotal,6750);assert.equal(q.fees.buyer_fee,0);assert.equal(result.body.totals.total,6750);
  assert.equal(q.promoter.commission_cents,1350);assert.equal(q.promoter.promoter_id,PROMOTER);
});
test('attendee requirement and unavailable/locked tickets are enforced',async()=>{
  const h=harness({event:{attendee_name_requirement:'required'}});
  assert.equal((await h.call('quote',buyer)).body.code,'names_required');
  assert.equal((await h.call('quote',{...buyer,attendeeNames:['Guest']})).status,200);
  h.tables.ticket_types[0].tier_visibility='locked';assert.equal((await h.call('quote',{...buyer,attendeeNames:['Guest']})).body.code,'tier_unavailable');
});
test('changing price after quoted total refuses checkout before any reservation',async()=>{
  const h=harness(),q=await h.call('quote',buyer);h.tables.ticket_types[0].price_cents=3500;
  const r=await h.call('checkout',{...buyer,...h.identity,quoteHash:q.body.quoteHash});
  assert.equal(r.body.code,'quote_changed');assert.equal(h.tables.orders.length,0);assert.equal(h.sessions.size,0);
});
test('prepare precedes Stripe; attachment precedes secret disclosure',async()=>{
  const h=harness();const {result}=await h.open();assert.equal(result.status,200);assert.equal(result.body.state,'payment_open');
  const prepare=h.log.indexOf('rpc:ticket_embed_prepare_checkout'),stripe=h.log.indexOf('stripe:POST:/checkout/sessions'),attach=h.log.indexOf('rpc:ticket_embed_attach_session');
  assert.ok(prepare<stripe && stripe<attach);const a=h.tables.ticket_embed_checkout_attempts[0];
  assert.equal(h.tables.orders[0].stripe_checkout_session_id,a.stripe_session_id);assert.equal(h.tables.ticket_holds[0].payment_intent_id,a.stripe_session_id);
});
test('Stripe parameters preserve destination, fees and webhook-compatible metadata',async()=>{
  const h=harness();await h.open({quantity:2,promoterCode:'TRE_1'});const a=h.tables.ticket_embed_checkout_attempts[0],p=stripeEmbedParameters(a);
  assert.equal(p.ui_mode,'embedded');assert.equal(p.redirect_on_completion,'never');assert.equal(p.success_url,undefined);
  assert.equal(p['payment_intent_data[transfer_data][destination]'],'acct_fixture');
  for(const field of ['type','event_id','ticket_type_id','quantity','guest_email','guest_name','dvnt_promoter_code'])assert.equal(p[`metadata[${field}]`],p[`payment_intent_data[metadata][${field}]`]);
  assert.equal(p['metadata[type]'],'event_ticket');assert.equal(p['metadata[quantity]'],'2');
  assert.equal(Number(p['payment_intent_data[application_fee_amount]']),a.quote.fees.application_fee_amount);
});
test('replay and refresh recover one order/hold/provider session without storing buyer fields in resume request',async()=>{
  const h=harness();const first=await h.open();const repeat=await h.call('checkout',first.payload);const resume=await h.call('resume',h.identity);
  assert.equal(repeat.status,200);assert.equal(resume.status,200);assert.equal(resume.body.clientSecret,first.result.body.clientSecret);
  assert.equal(h.tables.orders.length,1);assert.equal(h.tables.ticket_holds.length,1);assert.equal(h.sessions.size,1);
});
test('lost provider response retries the same immutable Stripe idempotency key',async()=>{
  const h=harness({faults:{lostResponse:true}});const first=await h.open();assert.equal(first.result.status,503);
  const retry=await h.call('resume',h.identity);assert.equal(retry.status,200);
  assert.equal(h.sessions.size,1);assert.equal(h.tables.orders.length,1);assert.equal(h.tables.ticket_holds.length,1);
});
test('attachment failure never exposes a client secret and retry uses the same session',async()=>{
  const h=harness({faults:{ticket_embed_attach_session:'database_temporary'}});const first=await h.open();
  assert.equal(first.result.status,503);assert.equal(first.result.body.clientSecret,undefined);
  delete h.faults.ticket_embed_attach_session;const retry=await h.call('resume',h.identity);assert.equal(retry.status,200);assert.equal(h.sessions.size,1);
});
for(const error of ['sold_out','buyer_limit','selection_changed','embed_unavailable','promoter_changed','organizer_changed']){
  test('atomic prepare rejection cannot create a payable session: '+error,async()=>{
    const h=harness({faults:{ticket_embed_prepare_checkout:error}});const r=await h.open();
    assert.equal(r.result.status,409);assert.equal(r.result.body.code,error);assert.equal(h.sessions.size,0);
  });
}
test('different buyer selection cannot reuse an attempt identity',async()=>{
  const h=harness();const first=await h.open();const r=await h.call('checkout',{...first.payload,quantity:2});
  assert.equal(r.body.code,'attempt_conflict');assert.equal(h.sessions.size,1);
});
test('unknown proof, foreign origin and other embed cannot read an order',async()=>{
  const h=harness();await h.open();
  for(const [body,origin] of [[{...h.identity,token:'e'.repeat(64)},ORIGIN],[h.identity,'https://other.example.com'],[{...h.identity,embedId:randomUUID()},ORIGIN]]){
    const r=await h.call('status',body,origin);assert.equal(r.status,404);assert.equal(r.body.tickets,undefined);
  }
});
test('revocation denies new buyers but existing checkout remains recoverable',async()=>{
  const h=harness();await h.open();h.tables.event_ticket_embed_settings[0].status='revoked';
  assert.equal((await h.call('quote',buyer)).status,404);assert.equal((await h.call('resume',h.identity)).status,200);
});
test('paid provider callback is not ticket fulfillment',async()=>{
  const h=harness();await h.open();const s=[...h.sessions.values()][0];s.payment_status='paid';s.status='complete';
  assert.equal((await h.call('status',h.identity)).body.state,'paid_issuing');
  h.tables.orders[0].status='paid';assert.equal((await h.call('status',h.identity)).body.state,'paid_issuing');
  h.tables.tickets.push({id:randomUUID(),order_id:h.tables.orders[0].id,status:'active',guest_lookup_token:randomUUID()});
  const r=await h.call('status',h.identity);assert.equal(r.body.state,'fulfilled');assert.equal(r.body.tickets.length,1);
  assert.equal(r.body.clientSecret,undefined);assert.equal(r.body.email,undefined);assert.match(r.body.tickets[0].url,/^https:\/\/dvntapp\.live\/public\/tickets\/guest\//);
});
test('session integrity mismatch denies both secret and receipt',async()=>{
  const h=harness();await h.open();const session=[...h.sessions.values()][0];session.amount_total=1;
  const r=await h.call('resume',h.identity);assert.equal(r.body.code,'session_mismatch');assert.equal(r.body.clientSecret,undefined);
});
test('unknown cancellation outcome retains the inventory hold',async()=>{
  const h=harness();await h.open();h.faults.expire=true;
  const r=await h.call('cancel',h.identity);assert.equal(r.status,503);assert.equal(h.tables.ticket_holds[0].status,'active');
});
test('confirmed Stripe expiration releases only this attempt hold',async()=>{
  const h=harness();await h.open();h.tables.ticket_holds.push({id:randomUUID(),status:'active'});
  const r=await h.call('cancel',h.identity);assert.equal(r.body.state,'expired');
  assert.equal(h.tables.ticket_holds[0].status,'released');assert.equal(h.tables.ticket_holds[1].status,'active');
});
test('paid cancellation cannot release held inventory or restart payment',async()=>{
  const h=harness();await h.open();const session=[...h.sessions.values()][0];session.status='complete';session.payment_status='paid';
  const r=await h.call('cancel',h.identity);assert.equal(r.body.state,'paid_issuing');assert.equal(h.tables.ticket_holds[0].status,'active');
});
test('expired never-exposed attempt can recover from a provider outage without a second charge',async()=>{
  const h=harness({faults:{stripe:true}});await h.open();h.advance(36*60000);
  const r=await h.call('resume',h.identity);assert.equal(r.body.state,'expired');assert.equal(h.tables.ticket_holds[0].status,'released');assert.equal(h.sessions.size,0);
});
test('refund status is not misrepresented as tickets ready',async()=>{
  const h=harness();await h.open();h.tables.orders[0].status='partially_refunded';assert.equal((await h.call('status',h.identity)).body.state,'partially_refunded');
});
test('rate-limit error stops preparation and hides provider internals',async()=>{
  const h=harness({faults:{limited:true}});assert.equal((await h.call('quote',buyer)).status,429);assert.equal(h.tables.orders.length,0);
});
test('widget renderer escapes event names, tiers and inline JSON script terminators',async()=>{
  const h=harness(),data=(await h.call('describe')).body;data.event.title='</script><script>alert(1)</script>';data.event.flyerUrl='javascript:alert(1)';
  data.tiers[0].name='<img src=x onerror=alert(1)>';
  const html=renderTicketEmbedWidget(data,'fixture');
  assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('\\u003c/script>'));assert.ok(!html.includes('src="javascript:'));
  assert.ok(html.includes('min-width:740px'));assert.ok(html.includes('top:12px'));
});

test('unattached cancellation is durable and cannot later expose the provider secret',async()=>{
 const h=harness({faults:{lostResponse:true}});await h.open();assert.equal(h.sessions.size,1);
 const cancelled=await h.call('cancel',h.identity);assert.equal(cancelled.body.state,'expired');
 const resumed=await h.call('resume',h.identity);assert.equal(resumed.body.state,'expired');assert.equal(resumed.body.clientSecret,undefined);
 assert.equal(h.tables.ticket_holds[0].status,'released');
});
