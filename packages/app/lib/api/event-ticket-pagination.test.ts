import { URL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function fixture(respond: (body: any, call: number) => any) {
  const exports: any = {}, calls: any[] = [];
  const code = ts.transpileModule(fs.readFileSync(new URL('./tickets.ts', import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(code, {exports, console: {warn() {}, error() {}}, require: (name: string) => name.endsWith('invoke-edge')
    ? {invokeEdge: async (_name: string, body: any) => {calls.push(body); return respond(body, calls.length);}} : {}});
  return {api: exports.ticketsApi, calls};
}
const row = (n: number) => ({id:`ticket-${n}`,created_at:`time-${n}`,status:n%3===0?'scanned':'active'});
for (const quantity of [0, 193, 200, 201, 400, 1207]) test(`all-roster wrapper returns all ${quantity} tickets, not just first 200`, async () => {
  const rows=Array.from({length:quantity}, (_,i)=>row(i));
  const f=fixture(body=>{
    const start=body.cursor?Number(body.cursor.id.slice(7))+1:0;
    const tickets=rows.slice(start,start+body.pageSize);
    const hasMore=start+tickets.length<rows.length;
    return {data:{ok:true,tickets,hasMore,nextCursor:hasMore?{id:tickets.at(-1)!.id,value:tickets.at(-1)!.created_at}:null},error:null};
  });
  const result=await f.api.getEventTickets('17');
  assert.equal(result.length,quantity);
  assert.equal(new Set(result.map((r:any)=>r.id)).size,quantity);
  assert.equal(f.calls.length,Math.max(1,Math.ceil(quantity/200)));
  assert.ok(f.calls.every(c=>c.event_id===17&&c.pageSize===200&&c.sort==='purchased_at'));
  if(quantity>200)assert.equal(f.calls[1].cursor.id,'ticket-199');
});

test('a later page failure throws instead of presenting a partial total', async()=>{
  const f=fixture((_body,n)=>n===1?{data:{ok:true,tickets:[row(1)],hasMore:true,nextCursor:{value:'time-1',id:'ticket-1'}}}:{error:{message:'Unavailable',status:503}});
  await assert.rejects(()=>f.api.getEventTickets('17'));
});
for(const mode of ['missing','repeated','empty']) test(`broken ${mode} pagination fails rather than looping or publishing partial counts`,async()=>{
  const f=fixture((_body,n)=>({data:{ok:true,tickets:mode==='empty'?[]:[row(n)],hasMore:true,nextCursor:mode==='missing'?null:{value:'time-1',id:'ticket-1'}}}));
  await assert.rejects(()=>f.api.getEventTickets('17'));
  assert.ok(f.calls.length<=2);
});

test('cursor paging deduplicates boundary repeats and continues to unseen rows',async()=>{
  const f=fixture((_body,n)=>({data:{ok:true,tickets:n===1?[row(1),row(2)]:[row(2),row(3)],hasMore:n===1,nextCursor:n===1?{value:'time-2',id:'ticket-2'}:null}}));
  assert.deepEqual(Array.from(await f.api.getEventTickets('17'),(r:any)=>r.id),['ticket-1','ticket-2','ticket-3']);
});

for (const response of [{ok:false},{ok:true},null]) test(`unconfirmed roster response ${JSON.stringify(response)} is not empty success`,async()=>{
  const f=fixture(()=>({data:response}));
  await assert.rejects(()=>f.api.getEventTickets('17'));
});
test('a changing cursor with no new tickets cannot cause an unbounded loop',async()=>{
  const f=fixture((_body,n)=>({data:{ok:true,tickets:[row(1)],hasMore:true,nextCursor:{value:`time-${n}`,id:`ticket-${n}`}}}));
  await assert.rejects(()=>f.api.getEventTickets('17'));
  assert.equal(f.calls.length,2);
});

for (const changeAt of ['before', 'after-first', 'after-second']) test(`door roster discards cancelled/account-switched scope ${changeAt}`, async () => {
  let current = changeAt !== 'before';
  const f = fixture((_body, n) => {
    if (changeAt === 'after-first' || (changeAt === 'after-second' && n === 2)) current = false;
    return {data:{ok:true,tickets:[row(n)],hasMore:n===1,nextCursor:n===1?{value:'time-1',id:'ticket-1'}:null}};
  });
  await assert.rejects(() => f.api.getEventTickets('17', () => current), /scope changed/);
  assert.equal(f.calls.length, changeAt === 'before' ? 0 : changeAt === 'after-first' ? 1 : 2);
});
