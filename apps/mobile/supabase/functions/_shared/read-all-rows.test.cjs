const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./payment-safety.test.cjs');
const path=require('node:path');
const {readAllRows}=harness().load(path.join(__dirname,'read-all-rows.ts'));
function pages(rows,{cap=200,errorAt=-1,repeat=false}={}) {
 let calls=0;const cursors=[];
 const factory=()=>{let cursor=null,limit=Infinity;const q={order:(key,opts)=>{assert.equal(key,'id');assert.equal(opts.ascending,true);return q;},limit:n=>{limit=n;return q;},gt:(key,id)=>{assert.equal(key,'id');cursor=id;return q;},then:(ok,bad)=>{cursors.push(cursor);const n=calls++;return Promise.resolve(n===errorAt?{data:null,error:Error('page failed')}:{data:rows.filter(r=>repeat||cursor===null||r.id>cursor).slice(0,Math.min(cap,limit)),error:null}).then(ok,bad);}};return q;};
 return {factory,cursors};
}
test('reads >1000 rows under a lower server cap until empty, including exact boundary',async()=>{
 for(const count of [0,200,201,1000,1001,2305]){const rows=Array.from({length:count},(_,i)=>({id:i+1}));const f=pages(rows);assert.equal((await readAllRows(f.factory)).length,count);assert.equal(f.cursors.length,Math.ceil(count/200)+1);}
});
test('fails closed on later page error, missing data, repeated IDs and exhausted bound',async()=>{
 await assert.rejects(readAllRows(pages([{id:1},{id:2}],{cap:1,errorAt:1}).factory),/page failed/);
 await assert.rejects(readAllRows(pages([{id:1}],{repeat:true}).factory),/repeated/);
 await assert.rejects(readAllRows(pages([{id:null}]).factory),/invalid/);
 const unavailable=()=>({order(){return this;},limit(){return this;},then(ok){return Promise.resolve({data:null,error:null}).then(ok);}});
 await assert.rejects(readAllRows(unavailable),/unavailable/);
 await assert.rejects(readAllRows(pages([{id:1},{id:2}],{cap:1}).factory,{maxPages:1}),/bounds/);
});
test('cursor scan does not offset-skip when earlier rows disappear',async()=>{
 const rows=[{id:1},{id:2},{id:3}];const p=pages(rows,{cap:1});let call=0;
 const factory=()=>{if(call++===1)rows.shift();return p.factory();};
 assert.deepEqual(Array.from(await readAllRows(factory),x=>x.id),[1,2,3]);
});

test('custom stable cursor scans lifecycle event_id under a smaller server cap', async () => {
 const rows = [{event_id: 3, room_uuid: 'a'}, {event_id: 7, room_uuid: 'b'}];
 const cursors = [];
 const factory = () => {
  let cursor = null;
  const q = {
   order(key, opts) { assert.equal(key, 'event_id'); assert.equal(opts.ascending, true); return q; },
   limit() { return q; },
   gt(key, value) { assert.equal(key, 'event_id'); cursor = value; return q; },
   then(ok, bad) { cursors.push(cursor); return Promise.resolve({data: rows.filter(r => cursor === null || r.event_id > cursor).slice(0, 1), error: null}).then(ok, bad); },
  };
  return q;
 };
 assert.deepEqual(Array.from(await readAllRows(factory, {cursorColumn: 'event_id'}), r => r.event_id), [3, 7]);
 assert.deepEqual(cursors, [null, 3, 7]);
 for (const cursorColumn of ['', 'id.desc', 'event_id)', 'room.id', 'id,secret', 'ID']) {
  await assert.rejects(readAllRows(factory, {cursorColumn}), /cursor column/);
 }
});

test('custom cursor rejects missing and duplicate keys rather than trusting id', async () => {
 const factory = (data) => () => ({order() {return this;}, limit() {return this;}, then(ok) {return Promise.resolve({data, error: null}).then(ok);}});
 await assert.rejects(readAllRows(factory([{id: 1}]), {cursorColumn: 'event_id'}), /invalid/);
 await assert.rejects(readAllRows(factory([{event_id: 1}, {event_id: 1}]), {cursorColumn: 'event_id'}), /repeated/);
});
