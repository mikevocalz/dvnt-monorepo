const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
function fixture(file, privacy, usersError = null) {
  const calls = [];
  const row = {id:42,auth_id:'author',username:'member',first_name:'Member',is_private:false,avatar:{url:'avatar'},followers_count:1};
  const db = {
    async rpc(name,args) {calls.push({name,args}); return privacy;},
    from(table) {
      if (table === 'user') throw new Error('Must not attempt auth-only Public fallback after failed users lookup');
      assert.equal(table,'users');
      const query = {select(){return query;},eq(){return query;}, single:async()=>({data:usersError ? null : row,error:usersError}),maybeSingle:async()=>({data:usersError ? null : row,error:usersError})};
      return query;
    },
  };
  function load(relative) {
    const exp={};
    const code=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','exports',code)(name=>{
      if(name.endsWith('effective-profile-privacy')) return load('packages/app/lib/profile/effective-profile-privacy.ts');
      if(name.endsWith('db-map')) return load('packages/app/lib/supabase/db-map.ts');
      if(name.endsWith('supabase/client')) return {supabase:db};
      if(name.endsWith('auth-helper')) return {getCurrentUserIdSync:()=>null,getCurrentUserId:async()=>null};
      if(name.endsWith('auth/identity')) return {getCurrentUserRow:async()=>null,ownEmailFor:()=>undefined};
      return {};
    },exp);
    return exp;
  }
  return {api:load(file).usersApi,calls};
}
for(const file of ['packages/app/lib/api/users.ts','apps/mobile/lib/api/users.ts']) {
  for(const [method,arg] of [['getProfileByUsername','member'],['getProfileById','42'],['getProfileById','author'],['getProfileByAuthUserId','author']]) {
    test(`${file} ${method}(${arg}) uses settings-aware private value despite stale public users flag`,async()=>{
      const f=fixture(file,{data:true,error:null});
      const profile=await f.api[method](arg);
      assert.equal(profile.isPrivate,true);
      assert.deepEqual(f.calls,[{name:'profile_is_private',args:{p_user_id:42}}]);
    });
    test(`${file} ${method}(${arg}) propagates missing migration/network privacy failure`,async()=>{
      for(const result of [{data:null,error:{message:'missing RPC'}},{data:null,error:null}]) {
        const f=fixture(file,result);
        await assert.rejects(f.api[method](arg),{name:'ProfilePrivacyUnavailable'});
      }
    });
  }
}

for (const file of ['packages/app/lib/api/users.ts','apps/mobile/lib/api/users.ts']) {
  for (const [method,arg] of [['getProfileByUsername','member'],['getProfileByAuthUserId','author']]) {
    test(`${file} ${method} does not fall back to Public after profile lookup failure`, async () => {
      const f=fixture(file,{data:true,error:null},{code:'PGRST301',message:'expired JWT'});
      await assert.rejects(f.api[method](arg),{name:'ProfilePrivacyUnavailable'});
      assert.deepEqual(f.calls,[]);
    });
  }
}

test('a failed privacy refetch overrides a real retained public query cache', async () => {
  const {QueryClient} = require('@tanstack/react-query');
  const exp={};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,'packages/app/lib/profile/effective-profile-privacy.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports',code)(exp);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const queryKey=['users','username','member'];
  client.setQueryData(queryKey,{isPrivate:false});
  const f=fixture('packages/app/lib/api/users.ts',{data:null,error:{code:'unavailable'}});
  await assert.rejects(client.fetchQuery({queryKey,queryFn:()=>f.api.getProfileByUsername('member')}),{name:'ProfilePrivacyUnavailable'});
  const state=client.getQueryState(queryKey);
  assert.equal(state.data.isPrivate,false, 'proves React Query retains stale data');
  assert.equal(exp.isProfilePrivacyUnavailable(state.error),true, 'screen guard must win over stale data');
  client.clear();
});
