// Execute the real identity guard against a synthetic signed-in store/session.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
module.exports=(getViewer,getEpoch=()=>0,getAuthId=()=>`fixture-auth-${getViewer()}`)=>{
 const exports={};const store={getState:()=>({isAuthenticated:!!getViewer(),user:getViewer()?{id:String(getViewer()),authId:getAuthId()}:null}),subscribe:()=>()=>{}};
 const deps={'./identity':{getAuthIdFromStore:()=>getViewer()?getAuthId():null},'./session-lifecycle':{getSessionLifecycle:()=>({ready:!!getViewer(),epoch:getEpoch(),authId:getViewer()?getAuthId():null})},'../stores/auth-store':{useAuthStore:store}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../packages/app/lib/auth/follow-identity.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],Set});
 return exports;
};
