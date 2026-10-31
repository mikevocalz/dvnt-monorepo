const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),deps=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),resolve=n=>require.resolve(n,{paths:[ROOT,...deps]});
const fixtures={
 fixture:`export const state={owner:{id:'fixture-owner'},session:{epoch:0,ready:true},calls:[],defer:false,release:null,result:{data:{ok:true,data:{enabled:false,status:'disabled'}},error:null}};`,
 '@dvnt/app/lib/stores/auth-store':`import {state} from 'fixture';export const useAuthStore={getState:()=>({user:state.owner})};`,
 '@dvnt/app/lib/auth/session-lifecycle':`import {state} from 'fixture';export const getSessionLifecycle=()=>state.session;`,
 '@dvnt/app/lib/auth/identity':`import {state} from 'fixture';export const requireBetterAuthToken=async()=>{if(state.defer)await new Promise(r=>state.release=r);return 'synthetic-token';};`,
 '@dvnt/app/lib/supabase/client':`import {state} from 'fixture';export const supabase={functions:{invoke:async(name,options)=>{state.calls.push({name,options});return state.result;}}};`,
 './function-error':`export const describeFunctionError=async()=>({message:'Request refused'});`,
};
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'followup-api-'));try{await require(resolve('esbuild')).build({stdin:{contents:`export {eventFollowupsApi as api} from './packages/app/lib/api/event-followups';export {state} from 'fixture';`,resolveDir:ROOT},bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'api.cjs'),plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'ts'}));}}]});const {api,state}=require(path.join(dir,'api.cjs'));
 await api.load(17);assert.equal(state.calls[0].name,'event-followup-settings?event_id=17');assert.equal(state.calls[0].options.method,'GET');assert.equal(state.calls[0].options.body,undefined);assert.equal(state.calls[0].options.headers['x-auth-token'],'synthetic-token');
 await api.save(17,{enabled:true,subject:'Subject',message:'Copy',cta_label:'Rate',delay_minutes:90,status:'sent',sent_count:4});assert.deepEqual(state.calls[1].options.body,{event_id:17,enabled:true,subject:'Subject',message:'Copy',cta_label:'Rate',delay_minutes:90});
 state.defer=true;const pending=api.save(17,{enabled:false});await Promise.resolve();state.owner={id:'other-owner'};state.release();await assert.rejects(pending,/sign in again/);assert.equal(state.calls.length,2);state.defer=false;
 state.result={data:null,error:{}};await assert.rejects(api.load(17),/Request refused/);state.result={data:{ok:false,error:'Forbidden'},error:null};await assert.rejects(api.load(17),/Forbidden/);await assert.rejects(api.load(0),/Invalid event/);console.log('PASS settings API: read-only GET, authenticated writes, exact allowed fields, account-switch refusal, errors fail closed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
