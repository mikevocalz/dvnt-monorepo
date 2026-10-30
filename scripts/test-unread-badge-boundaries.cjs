#!/usr/bin/env node
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const paths=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean);const resolve=name=>require.resolve(name,{paths});
const {build}=require(resolve('esbuild'));const {Window}=require(resolve('happy-dom'));
const root=path.resolve(__dirname,'..');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'badge-boundaries-'));
const mocks={
 auth:`import {create} from 'zustand';export const useAuthStore=create(()=>({user:{id:'101'},isAuthenticated:true,authStatus:'authenticated'}));`,
 client:`export const supabase={from(table){globalThis.F.table=table;const q={select(...args){globalThis.F.select=args;return q},eq(...args){globalThis.F.eq=args;return q},is(...args){globalThis.F.is=args;return q},then(resolve){return Promise.resolve(globalThis.F.response).then(resolve)}};return q}};`,
 helper:`export const getCurrentUserIdSync=()=>globalThis.F.viewer;`,
 identity:`export const requireBetterAuthToken=async()=>'';`,
 registry:`export const getQueryClient=()=>({invalidateQueries:(options)=>{globalThis.F.invalidations.push(options);return Promise.resolve()}});`,
 route:`const router={push(){}};export const useRouter=()=>router;`,
 rn:`export const Platform={OS:'ios'};`,
 watch:`export const registerWatchNotificationCategories=async()=>{};export const consumeWatchNotificationResponse=async()=>'ignored';export const subscribeWatchNotificationReadiness=()=>()=>{};export const restoreWatchNotificationActions=()=>{};`,
 notifications:`export const registerForPushNotificationsAsync=async()=>null;export const savePushTokenToBackend=async()=>{};`,
 activity:`export const useActivityStore=()=>({addActivity(){}});`,
 app:`export const useAppStore={getState:()=>({pendingNotificationRoute:null})};`,
 router:`export const routeFromNotification=()=>null;`,
 expo:`export function addNotificationReceivedListener(callback){globalThis.F.listener=callback;return{remove(){}}};export const addNotificationResponseReceivedListener=()=>({remove(){}});export const getLastNotificationResponseAsync=async()=>null;`,
};
const rules=[[/\/stores\/auth-store$/,'auth'],[/\/supabase\/client$/,'client'],[/\/api\/auth-helper$/,'helper'],[/\/auth\/identity$/,'identity'],[/\/lib\/auth-client$/,'registry'],[/^expo-router$/,'route'],[/^react-native$/,'rn'],[/\/watch\/watch-notification-actions$/,'watch'],[/\/lib\/notifications$/,'notifications'],[/\/stores\/activity-store$/,'activity'],[/\/stores\/app-store$/,'app'],[/\/notifications\/notificationRouter$/,'router'],[/^expo-notifications$/,'expo']];
(async()=>{
 await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {notificationsApi} from './packages/app/lib/api/notifications';import {useNotifications} from './packages/app/lib/hooks/use-notifications';export {notificationsApi};let root;function Push(){useNotifications();return <span>mounted</span>}export function mount(){root=createRoot(document.getElementById('root'));root.render(<Push/>)}export function unmount(){root.unmount()}`,resolveDir:root,loader:'tsx'},outfile:path.join(dir,'fixture.js'),bundle:true,format:'iife',globalName:'Fixture',platform:'browser',jsx:'automatic',tsconfigRaw:{},nodePaths:paths,alias:{'@dvnt/app':path.join(root,'packages/app'),...Object.fromEntries(['react','react-dom','zustand'].map(n=>[n,path.dirname(resolve(n+'/package.json'))]))},plugins:[{name:'synthetic-only',setup(b){b.onResolve({filter:/.*/},args=>{const name=args.path.startsWith('.')?path.resolve(args.resolveDir,args.path):args.path;const rule=rules.find(([r])=>r.test(name));if(rule)return{path:rule[1],namespace:'mock'}});b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}))}}],define:{'process.env.NODE_ENV':'"test"'}});
 const win=new Window({url:'http://localhost'});win.console.timeStamp=()=>{};win.document.body.innerHTML='<div id="root"></div>';win.F={response:{count:127,error:null},viewer:101,invalidations:[]};win.eval(fs.readFileSync(path.join(dir,'fixture.js'),'utf8'));
 try{
   const api=win.Fixture.notificationsApi;
   assert.deepEqual(JSON.parse(JSON.stringify(await api.getBadges())),{unread:127,total:0});assert.equal(win.F.table,'notifications');assert.equal(win.F.select[1].head,true);assert.equal(win.F.select[1].count,'exact');assert.deepEqual([...win.F.eq],['recipient_id',101]);assert.deepEqual([...win.F.is],['read_at',null]);
   win.F.response={count:0,error:Error('Synthetic denied')};await assert.rejects(api.getBadges(),/Synthetic denied/);
   win.F.response={count:null,error:null};await assert.rejects(api.getBadges(),/unavailable/);
   win.F.viewer=null;await assert.rejects(api.getBadges(),/Sign in/);win.F.viewer=101;
   win.Fixture.mount();for(let i=0;i<100&&!win.F.listener;i++)await new Promise(r=>setTimeout(r,10));assert.ok(win.F.listener,'push hook mounts WITHOUT QueryClientProvider at native root');
   const push=type=>win.F.listener({request:{content:{data:{type,senderId:'999'}}}});
   await push('message');await push('message');assert.equal(win.F.invalidations.length,2);assert.ok(win.F.invalidations.every(x=>x.queryKey[0]==='messages'&&x.exact));
   await push('ticket_transfer_initiated');assert.deepEqual([...win.F.invalidations.at(-1).queryKey],['badges','101']);
   win.Fixture.unmount();console.log('PASS notification count API exact/scoped/error contract; native push hook outside query provider; duplicate messages and all activity types only invalidate');
 }finally{await win.happyDOM.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
