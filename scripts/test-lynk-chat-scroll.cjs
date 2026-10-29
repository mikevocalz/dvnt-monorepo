/** Actual ChatPanel React behavior with measured-scroll adapters, not device QA. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const paths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean).concat(process.cwd());
const resolve = name => require.resolve(name, { paths });
(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lynk-chat-scroll-'));
  try {
    await require(resolve('esbuild')).build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
        import React, {act} from 'react'; import {createRoot} from 'react-dom/client';
        import {ChatPanel} from './packages/app/features/sneaky-lynk/ui/web/room-panels';
        export {act}; export function mount(node) {const root=createRoot(node);return {render:props=>root.render(<ChatPanel {...props}/>),unmount:()=>root.unmount()};}
      ` }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
      tsconfigRaw: {compilerOptions:{jsx:'react-jsx'}}, nodePaths: paths,
      alias: {'@dvnt/app':path.join(process.cwd(),'packages/app'),'react':path.dirname(resolve('react/package.json')),'react-dom':path.dirname(resolve('react-dom/package.json'))},
      outfile: path.join(temp,'fixture.cjs'),
    });
    const fixture = require(path.join(temp,'fixture.cjs'));
    const node = document.createElement('div'); document.body.append(node);
    const renderer=fixture.mount(node);
    let comments=[];
    const comment=id=>({id,body:`Message ${id}`,authorId:'guest',author:{username:'guest'},createdAt:new Date().toISOString()});
    const props={open:true,onClose(){},comments,currentUserId:'host',onSend:async()=>true};
    const render=async changes=>{Object.assign(props,changes);await fixture.act(async()=>renderer.render(props));};
    const list=()=>node.querySelector('[data-room-chat-messages]') || node.querySelector('div.overflow-y-auto');
    const jump=()=>node.querySelector('[aria-label="Jump to latest messages"]');
    await render({comments:Array.from({length:12},(_,i)=>comment(i+1))});
    let height=1200;
    Object.defineProperties(list(),{scrollHeight:{get:()=>height,configurable:true},clientHeight:{get:()=>300,configurable:true}});
    await fixture.act(async()=>{list().scrollTop=900;list().dispatchEvent(new window.Event('scroll',{bubbles:true}));});
    height=1300; await render({comments:[...props.comments,comment(13)]});
    assert.equal(list().scrollTop,1300,'pinned reader follows incoming messages');
    await fixture.act(async()=>{list().scrollTop=100;list().dispatchEvent(new window.Event('scroll',{bubbles:true}));});
    height=1400; await render({comments:[...props.comments,comment(14)]});
    assert.equal(list().scrollTop,100,'incoming message preserves a reader’s history position');
    assert.ok(jump(),'new messages have an explicit jump affordance');
    await fixture.act(async()=>jump().click());
    assert.equal(list().scrollTop,1400); assert.equal(jump(),null);
    await fixture.act(async()=>{list().scrollTop=0;list().dispatchEvent(new window.Event('scroll',{bubbles:true}));});
    await render({comments:[...props.comments,comment(15)]}); assert.ok(jump());
    await fixture.act(async()=>{list().scrollTop=1100;list().dispatchEvent(new window.Event('scroll',{bubbles:true}));});
    assert.equal(jump(),null,'manual scroll to latest clears unseen indicator');
    await fixture.act(async()=>{list().scrollTop=0;list().dispatchEvent(new window.Event('scroll',{bubbles:true}));});
    await render({comments:[...props.comments,comment(16)]}); assert.ok(jump());
    await fixture.act(async()=>jump().click());
    await fixture.act(async()=>{list().scrollTop=100;list().dispatchEvent(new window.Event('scroll',{bubbles:true}));});
    const count=props.comments.length;
    await render({comments:[...props.comments.slice(1),comment(17)]});
    assert.equal(props.comments.length,count,'rolling window keeps message count');
    assert.equal(list().scrollTop,100,'same-count new message preserves history');
    assert.ok(jump(),'new last message in rolling window still shows affordance');
    await render({open:false}); await render({open:true});
    assert.equal(jump(),null,'reopening clears unseen indicator and returns to latest');
    const input=node.querySelector('input');
    input.value='Keep my failed draft';
    let sent=[];
    await render({onSend:async body=>{sent.push(body);return false;}});
    await fixture.act(async()=>node.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
    assert.deepEqual(sent,['Keep my failed draft']);
    assert.equal(input.value,'Keep my failed draft','failed own send preserves draft');
    assert.equal(node.querySelector('[aria-label="Send message"]').disabled,false,'failed send releases sending guard');
    await render({onSend:async body=>{sent.push(body);return true;}});
    await fixture.act(async()=>node.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(input.value,'','successful retry clears only the submitted draft');
    assert.equal(sent.length,2,'failed message can be retried');
    await fixture.act(async()=>renderer.unmount());
    console.log('PASS: ChatPanel follows pinned chat, preserves history on incoming messages, jumps and clears on scroll/reopen. DOM adapters only.');
  } finally { await window.happyDOM.close(); fs.rmSync(temp,{recursive:true,force:true}); }
})().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
