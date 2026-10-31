// Executes the real guest handler and pricing modules. Database, email and Stripe
// are explicit fixtures: this suite never contacts a provider or charges a card.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const ts=require('typescript');
const ROOT=path.resolve(__dirname,'../../../../..');
const TIER='11111111-1111-4111-8111-111111111111';
const PROMO='22222222-2222-4222-8222-222222222222';
const PROMOTER='33333333-3333-4333-8333-333333333333';
const EMAIL='buyer@fixture.example';
const promo=(patch={})=>({id:PROMO,event_id:1,code:'SAVE10',ticket_type_id:null,
 discount_type:'percent',discount_value:10,deleted_at:null,uses_count:0,...patch});
const promoter=(patch={})=>({id:PROMOTER,event_id:1,code:'SHARE10',status:'active',
 customer_discount_bps:1000,promoter_commission_bps:1000,...patch});
function like(pattern,value){
 let re='^';
 for(let i=0;i<pattern.length;i++){
  let c=pattern[i];
  if(c==='\\'&&i+1<pattern.length)c=pattern[++i];
  else if(c==='%'){re+='.*';continue}
  else if(c==='_'){re+='.';continue}
  re+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }
 return new RegExp(re+'$','i').test(value);
}
function fixture(options={}){
 const tables={events:[{id:1,title:'Fixture event',visibility:'public',status:'active',ticketing_enabled:true,
 nsfw:false,host_id:'host',fee_mode:options.feeMode||'pass',attendee_name_requirement:'off',start_date:'2099-01-01T20:00:00Z',...options.event}],
 ticket_types:[{id:TIER,event_id:1,name:'Admission',price_cents:3000,is_active:true,status:'on_sale',tier_visibility:'public',
 quantity_total:100,quantity_sold:0,max_per_user:10,...options.tier}],orders:[],tickets:[],ticket_holds:[],order_timeline:[],
 organizer_accounts:[{host_id:'host',stripe_account_id:'acct_fixture',charges_enabled:true}],
 promo_codes:options.promos||[],event_promoters:options.promoters||[],promoter_attributions:[]};
 const writes=[],stripe=[],emails=[],usage=[],logs=[],profileCalls=[],qr=[];let serial=0;
 const db={rpc:async(fn,args)=>{
  writes.push({table:'rpc',fn,args});
  if(fn==='ticket_purchase_hold_atomic')return {data:{ok:true,holdId:'hold-fixture'},error:null};
  if(fn==='guest_free_checkout_atomic'){
   if(options.atomicError)return{data:null,error:options.atomicError};
   if(options.atomicResult)return{data:options.atomicResult,error:null};
   if(options.ticketInsertError)return{data:null,error:{message:'fixture atomic ticket insert failure'}};
   // This stub is only for handler contracts. The real SQL/rollback/locking
   // semantics are exercised by scripts/verify-guest-free-issuance.mjs.
   const order={id:'row-'+(++serial),status:'paid',currency:'usd',...args.p_order};
   delete order.expected_unit_price_cents;
   const rows=args.p_ticket_rows.map((t,i)=>({...t,order_id:order.id,order_index:i+1,order_count:order.quantity}));
   tables.orders.push(order);tables.tickets.push(...rows);
   tables.ticket_holds.push({id:'hold-'+serial,ticket_type_id:args.p_ticket_type_id,quantity:order.quantity,status:'converted'});
   tables.ticket_types.find(t=>t.id===args.p_ticket_type_id).quantity_sold+=order.quantity;
   tables.order_timeline.push({order_id:order.id,type:'created'},{order_id:order.id,type:'payment_captured'});
   return{data:{ok:true,idempotent:false,order_id:order.id,count:order.quantity,order},error:null};
  }
  if(fn==='increment_promo_uses'){usage.push(args.p_promo_id);return{data:null,error:null}}
  throw Error('Unexpected RPC '+fn);
 },from:table=>{
  assert.ok(table in tables,'unexpected table '+table);
  let filters=[],op='read',payload,head=false,conflict,selected='*';
  function run(){
   if(options.readError===table&&op==='read')return {data:null,error:{message:'fixture read failure'},count:null};
   let hit=tables[table].filter(row=>filters.every(f=>f(row)));
   if(op==='insert'&&table==='tickets'&&options.ticketInsertError)return{data:null,error:{message:'fixture ticket insert failure'}};
   if(op!=='read'){
    writes.push({table,op,payload});
    if(op==='upsert'){
     assert.equal(table,'promoter_attributions');assert.equal(conflict.onConflict,'order_id');assert.equal(conflict.ignoreDuplicates,true);
     assert.ok(tables.tickets.some(t=>t.order_id===payload.order_id),'attribution follows successful issuance');
     if(options.attributionThrow){options.attributionThrow=false;throw Error('fixture attribution exception')}
     if(options.attributionError){const error=options.attributionError;options.attributionError=null;return{data:null,error:{message:error}}}
     hit=tables[table].filter(row=>row.order_id===payload.order_id);
     if(!hit.length){hit=[{...payload}];tables[table].push(...hit)}
    }else if(op==='insert'){
     hit=(Array.isArray(payload)?payload:[payload]).map(row=>({id:'row-'+(++serial),...row}));tables[table].push(...hit);
    }else if(op==='update')hit.forEach(row=>Object.assign(row,payload));
    else if(op==='delete')tables[table]=tables[table].filter(row=>!hit.includes(row));
   }
   const projected=options.projectSelect && selected!=='*'
    ? hit.map(row=>Object.fromEntries(selected.split(',').map(key=>[key.trim(),row[key.trim()]]))) : hit;
   return {data:head?null:projected,count:hit.length,error:null};
  }
  const q={select(columns,opts){selected=columns;head=opts?.head===true;return q},eq(k,v){filters.push(row=>row[k]===v);return q},
   is(k,v){filters.push(row=>v===null?row[k]==null:row[k]===v);return q},
   ilike(k,v){filters.push(row=>like(v,String(row[k]??'')));return q},
   in(k,v){filters.push(row=>v.includes(row[k]));return q},limit(){return q},
   gt(k,v){filters.push(row=>row[k]>v);return q},
   upsert(v,opts){op='upsert';payload=v;conflict=opts;return q},insert(v){op='insert';payload=v;return q},update(v){op='update';payload=v;return q},delete(){op='delete';return q},
   maybeSingle:async()=>{const r=run();return{...r,data:r.data?.[0]??null}},
   single:async()=>{const r=run();return{...r,data:r.data?.[0]??null}},then:(a,b)=>Promise.resolve(run()).then(a,b)};
  return q;
 }};
 let handler;const cache=new Map();
 function load(file){
  const full=path.resolve(file);if(cache.has(full))return cache.get(full);
  const exports={};cache.set(full,exports);
  const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,Request,Response,URL,URLSearchParams,TextEncoder,
   Date:options.now==null?Date:class extends Date{constructor(...args){super(...(args.length?args:[options.now]))}static now(){return options.now}},crypto,console:{...console,error:(...args)=>logs.push(args)},
   Deno:{env:{get:k=>k==='STRIPE_SECRET_KEY'?(options.noStripe?'':'fixture-not-a-provider-key'):''},serve:fn=>{handler=fn}},
   fetch:async(url,opts)=>{
    assert.equal(new URL(url).hostname,'api.stripe.com');
    stripe.push({url,params:Object.fromEntries(new URLSearchParams(opts.body))});
    return Response.json({id:'cs_fixture_'+stripe.length,url:'https://checkout.stripe.com/c/pay/fixture'});
   },require:name=>{
    if(options.entrypoint && name.endsWith('/verify-session.ts'))return{verifySession:async()=>options.unauthorized?null:'member-fixture'};
    if(name.startsWith('https://esm.sh/@supabase/'))return{createClient:()=>db};
    if(name.endsWith('/hmac-qr.ts'))return{createSignedQrPayload:async()=>{qr.push(true);return{qrToken:'fixture',qrPayload:'fixture'}}};
    if(name.endsWith('/ticket-email-delivery.ts'))return{deliverTicketBundleEmail:async(...args)=>emails.push(args[1])};
    if(name.endsWith('/checkout-profile.ts'))return{recordCheckoutProfileIntake:async(...args)=>{profileCalls.push({kind:'intake',args})},provisionCheckoutProfile:async(...args)=>{profileCalls.push({kind:'provision',args});return null}};
    return load(path.resolve(path.dirname(full),name));
   }},{filename:full});return exports;
 }
 load(options.entrypoint || path.join(__dirname,'index.ts'));
 const selection={event_id:1,ticket_type_id:TIER,quantity:1,guest_email:EMAIL};
 async function call(body,method='POST'){
  const res=await handler(new Request('https://fixture.invalid/guest-checkout',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})}));
  return {status:res.status,headers:res.headers,data:await res.json()};
 }
 return{tables,writes,stripe,emails,usage,logs,profileCalls,qr,load,call,
  quote:(body={})=>call({action:'quote',quote_request:{...selection,...body}}),
  pay:(body={})=>call({...selection,...body})};
}
function stripeTotal(params){
 let total=0;for(let i=0;params[`line_items[${i}][quantity]`];i++)
 total+=Number(params[`line_items[${i}][quantity]`])*Number(params[`line_items[${i}][price_data][unit_amount]`]);
 return total;
}
async function checkoutWith(f,input){const q=await f.quote(input);assert.equal(q.status,200,JSON.stringify(q.data));
 const paid=await f.pay({...input,expected_quote_key:q.data.quote.quote_key});return{q:q.data.quote,paid};}


module.exports={fixture,checkoutWith,stripeTotal,promo,promoter,TIER,PROMO,PROMOTER,EMAIL,ROOT};
