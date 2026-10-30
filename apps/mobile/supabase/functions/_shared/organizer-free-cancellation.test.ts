import test from 'node:test';
import assert from 'node:assert/strict';
import { organizerFreeCancellation, parseOrganizerCancellation } from './organizer-free-cancellation.ts';
const ticket = { id:'11111111-1111-1111-1111-111111111111', event_id:80, user_id:'holder', status:'active', category:'admission', purchase_amount_cents:0 };
const order = { user_id:'holder',event_id:80,type:'event_ticket',status:'paid',total_cents:0,subtotal_cents:0 };
test('verified zero order is eligible without asserting comp provenance', () => {
  assert.deepEqual(organizerFreeCancellation(ticket,order,false),{eligible:true,reason:null});
});
for (const [label, patch] of Object.entries({
  paid:{purchase_amount_cents:100}, unknown:{purchase_amount_cents:null}, scanned:{status:'scanned'}, checked:{checked_in_at:'now'}, checker:{checked_in_by:'scanner'},
  refunded:{status:'refunded'}, void:{status:'void'}, pending:{status:'transfer_pending'}, transferred:{transferred_from:'sender'}, guest:{user_id:null},
  guestPhone:{guest_phone_e164:'+10000000000'}, claimed:{claimed_by:'holder'}, addon:{category:'product'}, cart:{cart_id:'cart'}, line:{cart_line_item_id:'line'},
  payment:{stripe_payment_intent_id:'pi'}, session:{stripe_checkout_session_id:'cs'},
})) test(`roster blocks ${label}`,()=>assert.equal(organizerFreeCancellation({...ticket,...patch},order,false).eligible,false));
for (const [label,patch] of Object.entries({paid:{total_cents:100}, discounted:{subtotal_cents:100}, discount:{discount_cents:100}, unknown:{total_cents:null}, refunded:{status:'refunded'}, owner:{user_id:'other'},event:{event_id:81},cart:{cart_id:'cart'},payment:{stripe_payment_intent_id:'pi'},session:{stripe_checkout_session_id:'cs'},promo:{promo_code_id:'promo'}}))
  test(`roster blocks ${label} order`,()=>assert.equal(organizerFreeCancellation(ticket,{...order,...patch},false).eligible,false));
test('missing legacy order and transfer histories fail closed',()=>{
  assert.equal(organizerFreeCancellation(ticket,null,false).eligible,false);
  assert.equal(organizerFreeCancellation(ticket,order,true).eligible,false);
});
const body={ticket_id:ticket.id,event_id:80,expected_owner_id:'holder',reason:' Wrong event '};
test('strict request contract trims reason and carries reviewed holder/event',()=>assert.deepEqual(parseOrganizerCancellation(body),{p_ticket_id:ticket.id,p_event_id:80,p_expected_owner_id:'holder',p_reason:'Wrong event'}));
for(const patch of [{ticket_id:'invalid'},{event_id:'80'},{event_id:NaN},{event_id:-1},{expected_owner_id:''},{reason:'    '},{reason:'x'.repeat(501)}])
  test(`invalid request ${JSON.stringify(patch)}`,()=>assert.equal(parseOrganizerCancellation({...body,...patch}),null));
