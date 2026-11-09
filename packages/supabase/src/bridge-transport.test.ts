import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeTransport } from './bridge-transport.ts';
const jwt = (sub: string, exp = Date.now()/1000+3600) => `e30.${btoa(JSON.stringify({sub,exp,role:'authenticated'}))}.test`;
test('fresh attached A never bypasses session resolver; correct B is selected', async () => {
  const bridge=createBridgeTransport('anon'); const a=jwt('A'), b=jwt('B'); bridge.setToken(a);
  bridge.setMinter(async()=>{bridge.setToken(b);return b;}); assert.equal(await bridge.accessToken(),b);
  bridge.setMinter(async()=>null); assert.equal(await bridge.accessToken(),'anon');
});
test('logout while token selection pending cannot return old token', async () => {
  const bridge=createBridgeTransport('anon'); const a=jwt('A');bridge.setToken(a);
  let resolve!: (value:string|null)=>void;
  bridge.setMinter(()=>new Promise(r=>{resolve=r;}));const pending=bridge.accessToken();bridge.setToken(null);resolve(a);
  assert.equal(await pending,'anon');
});
test('final fetch gate refuses A selected before B switch, without replacing A with B', async () => {
  const bridge=createBridgeTransport('anon');const a=jwt('A'),b=jwt('B');let calls=0;
  const send=bridge.guardFetch(async()=>{calls++;return new Response('[]');});
  bridge.setToken(a);bridge.setMinter(async()=>a);const selected=await bridge.accessToken();bridge.setToken(null);bridge.setToken(b);
  await assert.rejects(send('https://fixture.invalid/rest/v1/events',{method:'PATCH',headers:{Authorization:`Bearer ${selected}`}}),/account changed/);
  assert.equal(calls,0);
  await send('https://fixture.invalid/rest/v1/events',{method:'PATCH',headers:{Authorization:`Bearer ${b}`}});assert.equal(calls,1);
});
test('anonymous reads and explicit Better Auth edge function headers are untouched', async () => {
  const bridge=createBridgeTransport('anon');const seen:string[]=[];
  const send=bridge.guardFetch(async(_input,init)=>{seen.push(new Headers(init?.headers).get('Authorization')!);return new Response('{}');});
  await send('https://fixture.invalid/rest/v1/events',{headers:{Authorization:'Bearer anon'}});
  await send('https://fixture.invalid/functions/v1/media-upload',{headers:{Authorization:'Bearer opaque-better-auth-token'}});
  assert.deepEqual(seen,['Bearer anon','Bearer opaque-better-auth-token']);
});
test('malformed and expired attached credentials never leave the transport', async () => {
  for(const token of ['broken',jwt('A',1)]) {const b=createBridgeTransport('anon');b.setToken(token);b.setMinter(async()=>token);assert.equal(await b.accessToken(),'anon');}
});
test('request initiated as A cannot acquire B if switch precedes accessToken callback', async () => {
  const bridge=createBridgeTransport('anon');const a=jwt('A'),b=jwt('B');bridge.setToken(a);
  const expected=bridge.requestEpoch();
  bridge.setToken(null);bridge.setToken(b);bridge.setMinter(async()=>b);
  const selected=await bridge.accessToken();assert.equal(selected,b);
  let calls=0;const send=bridge.guardFetch(async()=>{calls++;return new Response('[]');});
  await assert.rejects(send('https://fixture.invalid/rest/v1/events',{method:'PATCH',headers:{Authorization:`Bearer ${selected}`,'x-dvnt-bridge-epoch':expected}}),/account changed/);
  assert.equal(calls,0);
});
test('local request epoch header is stripped before dispatch', async () => {
  const bridge=createBridgeTransport('anon');const a=jwt('A');bridge.setToken(a);
  const send=bridge.guardFetch(async(_input,init)=>{assert.equal(new Headers(init?.headers).has('x-dvnt-bridge-epoch'),false);return new Response('[]');});
  await send('https://fixture.invalid/rest/v1/events',{headers:{Authorization:`Bearer ${a}`,'x-dvnt-bridge-epoch':bridge.requestEpoch()}});
});

for (const method of ['GET','HEAD','PATCH','POST','DELETE']) test(`private notification ${method} never falls back to anon after bridge failure`, async () => {
  const bridge=createBridgeTransport('anon');bridge.setMinter(async()=>null);
  const bearer=await bridge.accessToken();let calls=0;
  const send=bridge.guardFetch(async()=>{calls++;return new Response('[]');});
  await assert.rejects(send('https://fixture.invalid/rest/v1/notifications?recipient_id=eq.1',{method,headers:{Authorization:`Bearer ${bearer}`}}),/private activity/);
  assert.equal(calls,0);
});
test('verified private requests pass, but expiry or signout before dispatch blocks them', async () => {
  const bridge=createBridgeTransport('anon');const a=jwt('A');bridge.setToken(a);
  let calls=0;const send=bridge.guardFetch(async()=>{calls++;return new Response('[]');});
  await send('https://fixture.invalid/rest/v1/notifications',{headers:{Authorization:`Bearer ${a}`}});
  bridge.setToken(null);
  await assert.rejects(send('https://fixture.invalid/rest/v1/notifications',{headers:{Authorization:`Bearer ${a}`}}),/private activity/);
  await assert.rejects(send('https://fixture.invalid/rest/v1/notifications'),/private activity/);
  assert.equal(calls,1);
});
