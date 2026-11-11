/** Classify one database snapshot, not a series of independently timed reads.
 * Historical units count toward original issuance, but are never usable proof.
 * No transferred holder identifiers or credentials leave this module. */
type Row = Record<string, any>;
const one = (v: any): Row | undefined => Array.isArray(v) ? v.length === 1 ? v[0] : undefined : v && typeof v === 'object' ? v : undefined;
const count = (v: any): number | undefined => { const n=one(v)?.count; return Number.isSafeInteger(n)&&n>=0?n:undefined; };
const positive = (v: any) => Number.isSafeInteger(v)&&v>0;
const text = (v: any) => typeof v==='string'&&v.length>0;
const TICKET_STATUSES=['active','scanned','transfer_pending','refunded','void'];
const ADDON_STATUSES=['unfulfilled','fulfilled','redeemed','refunded'];
export function cartFulfillmentSnapshot(cart: Row, actor: string) {
 const lines: Row[]=Array.isArray(cart.line_items)?cart.line_items:[];
 const tickets: Row[]=Array.isArray(cart.ticket_rows)?cart.ticket_rows:[];
 const addons: Row[]=Array.isArray(cart.addon_rows)?cart.addon_rows:[];
 const order=one(cart.order_rows);
 const orderMatches=count(cart.order_count)===1&&!!order&&text(order.id)&&order.cart_id===cart.id&&order.user_id===actor&&order.event_id===cart.event_id&&cart.user_id===actor;
 let valid=Array.isArray(cart.line_items)&&Array.isArray(cart.ticket_rows)&&Array.isArray(cart.addon_rows)&&lines.length>0 &&
   count(cart.line_count)===lines.length && count(cart.ticket_count)===tickets.length && count(cart.addon_count)===addons.length &&
   orderMatches;
 const byLine=new Map<string,Row>();const ids=new Set<string>();
 let expectedTickets=0,expectedAddons=0,usableTickets=0,usableAddons=0,historicalTickets=0,historicalAddons=0;
 const checks=lines.map(line=>{
  const isTicket=text(line.tier_id),isAddon=text(line.addon_id);
  if(!text(line.id)||byLine.has(line.id)||line.cart_id!==cart.id||!positive(line.quantity)||isTicket===isAddon||!Number.isSafeInteger(line.refunded_amount_cents)||line.refunded_amount_cents<0)valid=false;
  byLine.set(line.id,line);
  if(isTicket)expectedTickets+=line.quantity;else expectedAddons+=line.quantity;
  return {lineId:line.id,expected:line.quantity,kind:isTicket?'ticket':'addon',observed:0,usable:0,historical:0};
 });
 const lineProof=new Map(checks.map(c=>[c.lineId,c]));
 const credentialTokens=new Set<string>();
 const safeTickets:Row[]=[];const safeAddons:Row[]=[];
 for(const ticket of tickets){
  const line=byLine.get(ticket.cart_line_item_id),proof=lineProof.get(ticket.cart_line_item_id);
  const matches=!!line&&text(line.tier_id)&&ticket.cart_id===cart.id&&ticket.event_id===cart.event_id&&ticket.ticket_type_id===line.tier_id&&ticket.category===line.category&&ticket.order_id===order?.id;
  const known=TICKET_STATUSES.includes(ticket.status);
  if(!text(ticket.id)||ids.has(ticket.id)||!matches||!known)valid=false;ids.add(ticket.id);
  if(proof){proof.observed++;}
  // transfer_pending is not a usable credential, even for its sender.
  const usable=matches&&known&&ticket.user_id===actor&&ticket.status==='active'&&text(ticket.qr_token)&&text(ticket.qr_payload);
  if(usable){if(credentialTokens.has(ticket.qr_token))valid=false;credentialTokens.add(ticket.qr_token);usableTickets++;if(proof)proof.usable++;}
  else if(matches&&known&&(ticket.user_id!==actor||ticket.status!=='active')){historicalTickets++;if(proof)proof.historical++;}
  else valid=false;
  if(ticket.user_id!==actor)continue;
  const tier=one(ticket.ticket_types),event=one(ticket.events);
  safeTickets.push({id:ticket.id,event_id:ticket.event_id,ticket_type_id:ticket.ticket_type_id,status:ticket.status,usable,
   qr_token:usable?ticket.qr_token:null,qr_payload:usable?ticket.qr_payload:null,purchase_amount_cents:ticket.purchase_amount_cents,
   category:ticket.category,cart_id:cart.id,cart_line_item_id:ticket.cart_line_item_id,ticket_type_name:tier?.name||'General',
   event_title:event?.title||'',event_image:event?.cover_image_url||'',event_date:event?.start_date||'',event_end_date:event?.end_date||null,event_location:event?.location||''});
 }
 for(const addon of addons){
  const line=byLine.get(addon.cart_line_item_id),proof=lineProof.get(addon.cart_line_item_id),catalog=one(addon.ticket_addons),bound=one(addon.bound_ticket);
  const matches=!!line&&text(line.addon_id)&&addon.cart_id===cart.id&&addon.event_id===cart.event_id&&addon.addon_id===line.addon_id&&(addon.variant_id??null)===(line.variant_id??null)&&addon.order_id===order?.id&&positive(addon.quantity);
  const known=ADDON_STATUSES.includes(addon.status);
  if(!text(addon.id)||ids.has(addon.id)||!matches||!known)valid=false;ids.add(addon.id);
  if(proof&&positive(addon.quantity))proof.observed+=addon.quantity;
  const boundValid=addon.ticket_id==null||(!!bound&&bound.id===addon.ticket_id&&bound.event_id===cart.event_id&&TICKET_STATUSES.includes(bound.status));
  if(!boundValid)valid=false;
  const boundOwned=addon.ticket_id==null||(boundValid&&bound?.user_id===actor&&['active','scanned'].includes(bound.status));
  const owner=addon.user_id===actor;
  const credential= catalog?.is_redeemable===false || (catalog?.is_redeemable===true&&text(addon.qr_token)&&text(addon.qr_payload));
  const usable=matches&&known&&owner&&boundOwned&&['unfulfilled','fulfilled'].includes(addon.status)&&credential;
  if(usable){if(catalog?.is_redeemable){if(credentialTokens.has(addon.qr_token))valid=false;credentialTokens.add(addon.qr_token);}usableAddons+=addon.quantity;if(proof)proof.usable+=addon.quantity;}
  else if(matches&&known&&(!owner||!boundOwned||['redeemed','refunded'].includes(addon.status))){historicalAddons+=addon.quantity;if(proof)proof.historical+=addon.quantity;}
  else valid=false;
  // A transferred bound credential may still carry the old row owner while
  // its asynchronous transfer completes. Never expose that QR to the sender.
  if(!owner || (!boundOwned&&['unfulfilled','fulfilled'].includes(addon.status)))continue;
  safeAddons.push({id:addon.id,addon_id:addon.addon_id,variant_id:addon.variant_id??null,cart_line_item_id:addon.cart_line_item_id,
   addon_name:catalog?.name||'Add-on',variant_name:one(addon.ticket_addon_variants)?.name??null,quantity:addon.quantity,
   unit_price_cents:addon.unit_price_cents,status:addon.status,usable,is_redeemable:catalog?.is_redeemable===true,
   qr_token:usable?addon.qr_token??null:null});
 }
 if(!Number.isSafeInteger(expectedTickets)||!Number.isSafeInteger(expectedAddons)||checks.some(c=>c.observed>c.expected))valid=false;
 const complete=valid&&checks.every(c=>c.observed===c.expected);
 const paymentVerified=orderMatches&&order.status==='paid'&&text(order.paid_at)&&Number.isFinite(Date.parse(order.paid_at))&&
   order.currency===cart.currency&&Number.isSafeInteger(cart.total_cents)&&cart.total_cents>0&&order.total_cents===cart.total_cents&&
   /^pi_[A-Za-z0-9_]+$/.test(cart.stripe_pi_id||'')&&order.stripe_payment_intent_id===cart.stripe_pi_id;
 const historical=historicalTickets+historicalAddons>0||lines.some(l=>l.refunded_amount_cents>0)||['partially_refunded','refunded','disputed'].includes(order?.status);
 const state=cart.status!=='completed'?'unverified':!valid?'unverified':complete&&historical?'history':!paymentVerified?'unverified':
   !complete?'partial':usableTickets===expectedTickets&&usableAddons===expectedAddons?'ready':'unverified';
 return {tickets:safeTickets,addons:safeAddons,fulfillment:{state,paymentVerified,complete,expectedTickets,expectedAddons,usableTickets,usableAddons,historicalTickets,historicalAddons,lines:checks}};
}
