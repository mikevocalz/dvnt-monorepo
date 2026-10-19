import { URL } from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { eventTypeLabel, eventCardActionLabel, EVENT_TYPE_OPTIONS } from './event-type.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source=fs.readFileSync(new URL('../../features/events/events-list.web.tsx',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function LargeEventCard('),source.indexOf('\nfunction EventCard('));
const context:any={exports:{},require,eventTypeLabel,eventCardActionLabel,flyerFor:()=>({}),cardDate:()=> 'Friday',formatLikes:String,eventEnded:(e:any)=>e.ended,EVENT_CARD_ASPECT:1.5,Heart:()=>null,Calendar:()=>null,MapPin:()=>null,Zap:()=>null};
vm.runInNewContext(ts.transpileModule(code+'\nexports.Card=LargeEventCard;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
test('actual large-card markup renders type labels and paid/free/ended action variants',()=>{
 for(const [price,category,ended,label] of [[25,'party',false,'$25'],[35,'game_night',false,'$35'],[0,'pool_party',false,'RSVP'],[25,'other',true,'Ended']] as const){
  const html=renderToStaticMarkup(React.createElement(context.exports.Card,{event:{title:'Test',price,category,ended},onOpen(){},onToggleLike(){}}));
  assert.ok(html.includes(eventTypeLabel(category)));
  assert.ok(html.endsWith('>'+label+'</span></div></div></div>'),html);
  if(price>0)assert.ok(!html.includes('RSVP'));
 }
});
test('native filters use every canonical stored type while keeping their approved presentation labels',()=>{
 const filters=fs.readFileSync(new URL('../constants/event-categories.ts',import.meta.url),'utf8');
 const values=[...filters.matchAll(/value: "([a-z_]+)"/g)].map(m=>m[1]).filter(v=>!['none'].includes(v));
 for(const option of EVENT_TYPE_OPTIONS)assert.ok(values.includes(option.value),option.value);
 assert.ok(!values.includes('side_session'));
 assert.ok(!values.includes('midnight_fellowship'));
 assert.ok(!values.includes('fetish_demo'));
});
