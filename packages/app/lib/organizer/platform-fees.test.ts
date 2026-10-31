import test from 'node:test';
import assert from 'node:assert/strict';
import { platformFeePresentation } from './platform-fees.ts';
const fees = {amountCents:12345,currency:'USD',month:'2026-10',timeZone:'America/New_York' as const,status:'ready' as const};
test('verified platform amount keeps cents and explicit reporting period',()=>{assert.deepEqual(platformFeePresentation(fees),{noTransactions:false,asOf:null,amount:'$123.45',period:'October 2026 · America/New_York',unavailable:false});});
test('verified free month is zero, unknown is not zero',()=>{assert.equal(platformFeePresentation({...fees,amountCents:0}).amount,'$0.00');for(const input of [undefined,null,{...fees,amountCents:null},{...fees,status:'unavailable' as const},{...fees,currency:null},{...fees,amountCents:NaN},{...fees,amountCents:12.1}])assert.equal(platformFeePresentation(input).amount,'—');});
test('refund-adjusted signed value is formatted without client arithmetic',()=>{assert.equal(platformFeePresentation({...fees,amountCents:-125}).amount,'-$1.25');});

test('verification timestamp is explicit New York time; missing invalid pending dates are omitted',()=>{assert.match(platformFeePresentation({...fees,asOf:'2026-10-31T13:00:00Z'}).asOf!,/Verified Oct 31, 2026, 9:00 AM EDT/);assert.equal(platformFeePresentation({...fees,asOf:'not a date'}).asOf,null);assert.equal(platformFeePresentation({...fees,asOf:'2026-10-31T13:00:00Z',status:'pending'}).asOf,null);});

test('empty cohort does not invent currency or pretend source failure',()=>{const result=platformFeePresentation({...fees,amountCents:0,currency:null});assert.equal(result.amount,'—');assert.equal(result.noTransactions,true);assert.equal(result.unavailable,false);});
