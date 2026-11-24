const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {build}=require('esbuild');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const fixture={
 '@dvnt/app/lib/api/tickets':`export const state={calls:[],pending:[]};export const ticketsApi={getEventTicketsPaginated:(id,opts)=>{state.calls.push({id,opts});return new Promise((resolve,reject)=>state.pending.push({resolve,reject}))}};`,
 '@dvnt/app/lib/stores/auth-store':`import {create} from 'zustand';export const useAuthStore=create(()=>({user:{id:1,authId:'staff'}}));`,
};
(async()=>{const output=await build({stdin:{contents:`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {DoorContactLookup} from './packages/app/features/events/door-contact-lookup.web';import {state} from '@dvnt/app/lib/api/tickets';import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';window.api={state,auth:useAuthStore,act,root:createRoot(document.getElementById('root')),render:(eventId='1',door=true)=><DoorContactLookup eventId={eventId} checkingInToken={null} onCheckIn={door?token=>state.token=token:undefined}/>};`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>{if(fixture[a.path])return {path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/'))return {path:path.join(root,'packages/app',a.path.slice(10)+'.ts')};});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixture[a.path],loader:'tsx',resolveDir:root}));}}]});
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.MessageChannel=class{constructor(){this.port1={onmessage:null};this.port2={postMessage:()=>setTimeout(()=>this.port1.onmessage?.(),0)}}};w.IS_REACT_ACT_ENVIRONMENT=true;w.eval(output.outputFiles[0].text);const a=w.api;const flush=async fn=>a.act(async()=>{fn?.();await new Promise(r=>setTimeout(r,0))});
 const input=()=>w.document.querySelector('input');const click=text=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===text).click();
 const kind=async value=>flush(()=>{const select=w.document.querySelector('select');select.value=value;select.dispatchEvent(new w.Event('change',{bubbles:true}));});
 const type=async value=>flush(()=>{Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input(),value);input().dispatchEvent(new w.Event('input',{bubbles:true}));});
 try{await flush(()=>a.root.render(a.render()));await type('guest@example.com');assert.equal(a.state.calls.length,0,'typing never enumerates contacts');await flush(()=>click('Find'));assert.equal(a.state.calls.length,1);assert.equal(a.state.calls[0].opts.contactLookup.kind,'email');assert.equal(a.state.calls[0].opts.contactLookup.value,'guest@example.com');await flush(()=>click('Finding…'));assert.equal(a.state.calls.length,1,'duplicate submit prevented');
 await type('other@example.com');await flush(()=>a.state.pending.shift().resolve({tickets:[{id:'late',holder_name:'Stale holder',qr_token:'q',status:'active'}]}));assert.doesNotMatch(w.document.body.textContent,/Stale holder/);
 await flush(()=>click('Find'));await flush(()=>a.state.pending.shift().resolve({tickets:[{id:'a',holder_name:'Guest One',ticket_type_name:'General',qr_token:'qr',status:'active',category:'admission'}],hasMore:false}));assert.match(w.document.body.textContent,/Guest One/);await flush(()=>click('Check in'));assert.equal(a.state.token,'qr');assert.equal(input().value,'','successful selection clears stale check-in candidates');assert.equal(input().value,'');assert.doesNotMatch(w.document.body.textContent,/Guest One/);
 await type('service@example.com');await flush(()=>click('Find'));await flush(()=>a.state.pending.shift().resolve({tickets:[{id:'service',holder_name:'Service Guest',qr_token:'service-qr',status:'active',category:'service'}]}));const serviceButton=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Use service redemption');assert.equal(serviceButton.disabled,true,'service ticket cannot be admitted through contact lookup');await flush(()=>click('Clear contact lookup'));
 await type('next@example.com');await flush(()=>click('Find'));await flush(()=>a.root.render(a.render('2')));await flush(()=>a.state.pending.shift().resolve({tickets:[{id:'stale',holder_name:'Other event',status:'active'}]}));assert.doesNotMatch(w.document.body.textContent,/Other event/);assert.equal(input().value,'');
 await type('final@example.com');await flush(()=>click('Find'));await flush(()=>a.auth.setState({user:null}));await flush(()=>a.state.pending.shift().resolve({tickets:[{id:'stale',holder_name:'Other account',status:'active'}]}));assert.doesNotMatch(w.document.body.textContent,/Other account/);assert.equal(input().value,'');
 await flush(()=>a.auth.setState({user:{id:1,authId:'staff'}}));await flush(()=>a.root.render(a.render('2',false)));
 await kind('username');await type(' @@bad ');await flush(()=>click('Find'));assert.match(w.document.body.textContent,/Enter the complete username/);
 const before=a.state.calls.length;await type(' @DeCk.GueSt ');assert.equal(a.state.calls.length,before);await flush(()=>click('Find'));
 assert.deepEqual(JSON.parse(JSON.stringify(a.state.calls.at(-1).opts.contactLookup)),{kind:'username',value:'deck.guest'});
 await flush(()=>a.state.pending.shift().resolve({tickets:[{id:'guest1',holder_name:'Exact guest',status:'active',qr_token:'not-shown'}]}));
 assert.match(w.document.body.textContent,/Exact guest/);assert.doesNotMatch(w.document.body.textContent,/Check in|not-shown/);
 await kind('phone');assert.equal(input().value,'');await type('(212) 555-0199');await flush(()=>click('Find'));
 assert.deepEqual(JSON.parse(JSON.stringify(a.state.calls.at(-1).opts.contactLookup)),{kind:'phone',value:'+12125550199'});
 await flush(()=>a.state.pending.shift().reject({status:429}));assert.match(w.document.body.textContent,/Too many ticket lookups/);
 console.log('PASS exact username/email/phone, organizer read-only, duplicate guard, redacted rows, shared check-in, rate-limit message and stale input/event/account guards');
 }finally{await flush(()=>a.root.unmount());w.close();}
 if(process.env.DVNT_CONTACT_CHROMIUM==='1') {
   const { chromium }=require('playwright-core'), chrome=require('@sparticuz/chromium');
   const browser=await chromium.launch({executablePath:await chrome.executablePath(),args:chrome.args});
   try {
     const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
     const attempted=[];await page.route('**/*',r=>{attempted.push(r.request().url());return r.abort();});
     await page.setContent('<div id="root"></div>');
     await page.addScriptTag({content:output.outputFiles[0].text});
     await page.evaluate(()=>window.api.root.render(window.api.render('17')));
     const contact=page.getByRole('textbox',{name:'Complete checkout contact'});
     const type=page.getByRole('combobox',{name:'Contact type'});
     for(const [kind,value,expected] of [['username',' @Dvnt.Guest ','dvnt.guest'],['email',' Guest@EXAMPLE.invalid ','guest@example.invalid'],['phone','001 (212) 555-0199','+12125550199']]){
       const prior=await page.evaluate(()=>window.api.state.calls.length);
       await type.selectOption(kind);await contact.fill(value);
       assert.equal(await page.evaluate(()=>window.api.state.calls.length),prior);
       await page.getByRole('button',{name:'Find',exact:true}).click();
       assert.deepEqual(await page.evaluate(()=>window.api.state.calls.at(-1)),{id:'17',opts:{pageSize:200,contactLookup:{kind,value:expected}}});
       await page.evaluate(()=>window.api.state.pending.shift().resolve({tickets:[{id:'one',holder_name:'Visible holder',qr_token:'synthetic-qr',status:'active',category:'admission'}]}));
       await page.getByText('Visible holder').waitFor();
     }
     await page.getByRole('button',{name:'Check in'}).click();
     assert.equal(await page.evaluate(()=>window.api.state.token),'synthetic-qr');
     assert.equal(await contact.inputValue(),'');
     assert.deepEqual(attempted,[]);
     console.log('PASS mounted contact component in mobile Chromium for three modes, no external traffic');
   } finally {await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
