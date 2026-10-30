import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeAuthController } from './realtime-auth.ts';
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
test('private realtime gate awaits explicit token application', async () => {
  const auth = deferred<void>(); const calls: string[] = [];
  const controller = createRealtimeAuthController({accessToken: async () => 'signed-A',requestEpoch: () => '1',anonKey:'anon',setAuth:async token => {calls.push(token); await auth.promise;}});
  const ready = controller.ensureBridgeRealtimeAuth;
  let done = false;const pending = ready().then(value => {done=true;return value;});
  await new Promise(r=>setImmediate(r));assert.equal(done,false);assert.deepEqual(calls,['signed-A']);
  auth.resolve();assert.equal(await pending,true);
});
test('anon, failed refresh and socket errors fail closed without exposing tokens', async () => {
  let calls=0;
  for(const accessToken of [async()=> 'anon',async()=> '',async()=>{throw Error('private');}]) {
    const ready=createRealtimeAuthController({accessToken,requestEpoch:()=> '1',anonKey:'anon',setAuth:async()=>{calls++;}}).ensureBridgeRealtimeAuth;
    assert.equal(await ready(),false);
  }
  assert.equal(calls,0);
  assert.equal(await createRealtimeAuthController({accessToken:async()=> 'signed-A',requestEpoch:()=> '1',anonKey:'anon',setAuth:async()=>{throw Error('private');}}).ensureBridgeRealtimeAuth(),false);
});
test('sign-out/account switch during socket auth cannot approve a stale subscription', async () => {
  let epoch='1',token='signed-A';const auth=deferred<void>();
  const ready=createRealtimeAuthController({accessToken:async()=>token,requestEpoch:()=>epoch,anonKey:'anon',setAuth:async()=>auth.promise}).ensureBridgeRealtimeAuth;
  const pending=ready();await Promise.resolve();epoch='2';token='signed-B';auth.resolve();assert.equal(await pending,false);
});
test('token invalidated without epoch change during final verification fails closed', async () => {
  let calls=0;
  const ready=createRealtimeAuthController({accessToken:async()=>++calls===1?'signed-A':'anon',requestEpoch:()=> '1',anonKey:'anon',setAuth:async()=>{}}).ensureBridgeRealtimeAuth;
  assert.equal(await ready(),false);
});

test('all explicit socket updates serialize; delayed A cannot overwrite queued B or logout', async () => {
  for (const finalToken of ['signed-B','anon']) {
    let epoch='1',current='signed-A',socket='anon';const a=deferred<void>();const calls:string[]=[];
    const controller=createRealtimeAuthController({accessToken:async()=>current,requestEpoch:()=>epoch,anonKey:'anon',setAuth:async token=>{calls.push(token);if(token==='signed-A')await a.promise;socket=token;}});
    const initial=controller.ensureBridgeRealtimeAuth();await new Promise(r=>setImmediate(r));
    epoch='2';current=finalToken;const final=controller.updateAuth(finalToken);
    a.resolve();await final;assert.equal(await initial,false);assert.equal(socket,finalToken);assert.deepEqual(calls,['signed-A',finalToken]);
  }
});
test('superseded queued credentials do not apply and failure cannot block the latest auth reset', async () => {
  const applied:string[]=[];
  const controller=createRealtimeAuthController({accessToken:async()=> 'anon',requestEpoch:()=> '1',anonKey:'anon',setAuth:async token=>{applied.push(token);if(token==='bad')throw Error('unavailable');}});
  const stale=controller.updateAuth('A');const latest=controller.updateAuth('B');await Promise.all([stale,latest]);assert.deepEqual(applied,['B']);
  await assert.rejects(controller.updateAuth('bad'));await controller.updateAuth('anon');assert.equal(applied.at(-1),'anon');
});

test('concurrent same-account gates wait for the latest socket write instead of accepting skipped work', async () => {
  const auth=deferred<void>();let done=0;
  const controller=createRealtimeAuthController({accessToken:async()=> 'signed-A',requestEpoch:()=> '1',anonKey:'anon',setAuth:async()=>auth.promise});
  const first=controller.ensureBridgeRealtimeAuth().then(v=>{done++;return v;});
  const second=controller.ensureBridgeRealtimeAuth().then(v=>{done++;return v;});
  await new Promise(r=>setImmediate(r));assert.equal(done,0);auth.resolve();assert.deepEqual(await Promise.all([first,second]),[true,true]);
});
