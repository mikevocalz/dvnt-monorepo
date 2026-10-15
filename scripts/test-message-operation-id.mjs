// Isolated messages.operation_id contract: no live recipients or sends.
// NODE_PATH=<path containing @electric-sql/pglite> node --test this-file
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { postConversationMessage } = await import(
  "../apps/mobile/supabase/functions/_shared/conversation-delivery.ts"
);
const migration = readFileSync(resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/mobile/supabase/migrations/20261015033000_messages_operation_id.sql",
), "utf8");

test("additive message operation index rejects sender-scoped duplicates without touching legacy rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE public.messages (
        id serial PRIMARY KEY,
        conversation_id integer NOT NULL,
        sender_id integer NOT NULL,
        content varchar NOT NULL,
        metadata jsonb
      );
      INSERT INTO public.messages(conversation_id,sender_id,content)
      VALUES (2,11,'historical'),(2,11,'second legacy');
    `);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`
      INSERT INTO messages(conversation_id,sender_id,content,operation_id)
      VALUES (2,11,'hello','welcome_dm_v2:11:dm');
    `);
    await assert.rejects(
      db.exec(`INSERT INTO messages(conversation_id,sender_id,content,operation_id)
        VALUES (2,11,'hello again','welcome_dm_v2:11:dm');`),
      /duplicate key/,
    );
    // Unique per sender, not globally; other senders may choose same UUID.
    await db.exec(`
      INSERT INTO messages(conversation_id,sender_id,content,operation_id)
      VALUES (2,12,'different sender','welcome_dm_v2:11:dm');
      INSERT INTO messages(conversation_id,sender_id,content) VALUES (2,11,'new legacy');
    `);
    const {rows}=await db.query("SELECT count(*)::int AS n FROM messages");
    assert.equal(rows[0].n,5);
  } finally { await db.close(); }
});

function mockDb(){
  const messages=[];
  let nextId=1;
  let lastConversationUpdated=false;
  const db={
    get messages(){return messages;},
    get lastConversationUpdated(){return lastConversationUpdated;},
    from(name){
      if(name==="conversations_rels"){
        const q={
          select(){return q;},eq(){return q;},
          async single(){return {data:{id:101},error:null};},
        };
        return q;
      }
      if(name==="conversations"){
        return {update(){return {async eq(){lastConversationUpdated=true;return{error:null};}};}};
      }
      if(name==="messages"){
        const result={
          insert(payload){return {select(){return {async single(){
            if(payload.operation_id && messages.some(m=>m.sender_id===payload.sender_id&&m.operation_id===payload.operation_id)){
              return {data:null,error:{code:"23505",message:"duplicate key"}};
            }
            const record={id:nextId++,...payload};
            messages.push(record);
            return {data:record,error:null};
          }};}};},
          select(){
            let key=null,sender=null;
            const q={
              eq(column,value){
                if(column==="operation_id") key=value;
                if(column==="sender_id") sender=value;
                return q;
              },
              async maybeSingle(){return {data:messages.find(m=>m.operation_id===key && m.sender_id===sender)||null,error:null};},
            };
            return q;
          },
        };
        return result;
      }
      throw new Error("Unexpected table "+name);
    },
  };
  return db;
}

test("lost acknowledgement reuses the same persisted DM rather than sending again",async()=>{
  const db=mockDb();
  const first=await postConversationMessage(db,{
    conversationId:44,senderAuthId:"brand",senderId:11,
    content:"Welcome",metadata:{brandAnnouncement:true,idempotencyKey:"v2:1:dm"},
    operationId:"v2:1:dm",
  });
  assert.deepEqual(first,{ok:true,messageId:"1"});
  const replay=await postConversationMessage(db,{
    conversationId:44,senderAuthId:"brand",senderId:11,
    content:"Welcome",metadata:{idempotencyKey:"v2:1:dm",brandAnnouncement:true},
    operationId:"v2:1:dm",
  });
  assert.deepEqual(replay,first);
  assert.equal(db.messages.length,1);
  assert.equal(db.lastConversationUpdated,true);
});

test("reused key with different copy, metadata or conversation is rejected without leaking the original",async()=>{
  const db=mockDb();
  const base={
    conversationId:44,senderAuthId:"brand",senderId:11,content:"Welcome",
    metadata:{automated:true},operationId:"welcome:11:dm",
  };
  assert.equal((await postConversationMessage(db,base)).ok,true);
  for(const change of [
    {content:"Other copy"},
    {conversationId:45},
    {metadata:{automated:false}},
  ]){
    const result=await postConversationMessage(db,{...base,...change});
    assert.equal(result.ok,false);
    assert.match(result.error,/different message/);
  }
  assert.equal(db.messages.length,1);
});

test("legacy sends without operation IDs are still allowed",async()=>{
  const db=mockDb(), args={
    conversationId:44,senderAuthId:"brand",senderId:11,content:"Hello",
  };
  const one=await postConversationMessage(db,args);
  const two=await postConversationMessage(db,args);
  assert.notEqual(one.messageId,two.messageId);
  assert.equal(db.messages.length,2);
});
