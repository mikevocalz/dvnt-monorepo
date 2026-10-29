import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eventPublishError,shouldDiscardPreparedRoom} from './event-publish-error.ts';
import {describeFunctionError} from '../api/function-error.ts';
const attempt={authId:'host-a',requestId:'draft-a'};
const current={authId:'host-a',preparedRoom:{authId:'host-a',requestId:'draft-a'}};
test('structured HTTP refusal survives transport parsing and event error wrapping',async()=>{
 const parsed=await describeFunctionError({context:new Response(JSON.stringify({ok:false,error:{code:'room_unavailable',message:'Prepared room expired'}}),{status:409})});
 assert.deepEqual(parsed,{message:'Prepared room expired',status:409,code:'room_unavailable'});
 const error=eventPublishError(parsed);assert.equal(error.message,'Prepared room expired');assert.equal(error.code,'room_unavailable');
 assert.equal(shouldDiscardPreparedRoom(error,attempt,current),true);
});
test('uncertain network errors, other refusals, and stale account or draft never clear prepared room',()=>{
 for(const error of [new Error('room_unavailable'),eventPublishError({message:'Network error'}),eventPublishError({code:'internal_error'}),eventPublishError({code:'forbidden'}),null]) assert.equal(shouldDiscardPreparedRoom(error,attempt,current),false);
 const error=eventPublishError({code:'room_unavailable'});
 for(const state of [{...current,authId:'host-b'},{...current,preparedRoom:{authId:'host-a',requestId:'draft-b'}},{...current,preparedRoom:{authId:'host-b',requestId:'draft-a'}},{...current,preparedRoom:null}]) assert.equal(shouldDiscardPreparedRoom(error,attempt,state),false);
});
test('nonresponse transport error is not given a server error code',async()=>{
 const parsed=await describeFunctionError({message:'Timed out'});assert.equal(parsed.code,undefined);assert.equal(parsed.message,'Timed out');
});
