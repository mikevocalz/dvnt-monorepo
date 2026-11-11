import {test} from 'node:test';import assert from 'node:assert/strict';
import {settlementSummaryLines} from './settlement-status.ts';
test('absence and historical earnings never imply bank paid',()=>{
 assert.match(settlementSummaryLines(undefined,'promoter')[0],/not verified/);
 assert.match(settlementSummaryLines({verified:true,rows:[]},'promoter')[0],/not marked bank-paid/);
});
test('transfer-only state stays explicitly bank-unverified and currency stays separate',()=>{
 const lines=settlementSummaryLines({verified:true,rows:[{currency:'usd',recipient_role:'promoter',stage:'in_connected_balance',amount_cents:9782,allocation_count:16},{currency:'eur',recipient_role:'promoter',stage:'bank_failed',amount_cents:200,allocation_count:1}]},'promoter');
 assert.deepEqual(lines,['In Stripe balance; bank payout unverified: 97.82 USD','Bank payout failed: 2.00 EUR']);
});
test('bank membership describes included transfer amount, not net paid; unknown states fail closed',()=>{
 assert.match(settlementSummaryLines({verified:true,rows:[{currency:'usd',recipient_role:'organizer',stage:'bank_paid',amount_cents:8500,allocation_count:1}]},'organizer')[0],/Included in verified bank payout/);
 assert.equal(settlementSummaryLines({verified:true,rows:[{currency:'usd',recipient_role:'organizer',stage:'future',amount_cents:8500,allocation_count:1}]},'organizer')[0],'Payment status needs review.');
});
test('verified bank net contribution is separate from gross transfer allocation',()=>{
 assert.equal(settlementSummaryLines({verified:true,rows:[{currency:'usd',recipient_role:'promoter',stage:'bank_paid',amount_cents:1000,allocation_count:1,bank_net_contribution_cents:975}]},'promoter')[0],'Included in verified bank payout: 10.00 USD gross; verified bank contribution 9.75 USD');
});
