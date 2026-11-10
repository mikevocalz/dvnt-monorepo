const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireFn, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code, {exports, require:requireFn, console, Response, ...extra}, {filename:file});
  return exports;
}
for (const endpoint of ['get-followers','get-following']) {
  for (const [scenario, viewer, access, allowed] of [
    ['anonymous private',null,{is_private:true,is_following:false,is_blocked:false},false],
    ['pending private',1,{is_private:true,is_following:false,is_blocked:false},false],
    ['approved private',1,{is_private:true,is_following:true,is_blocked:false},true],
    ['preserved private',1,{is_private:true,is_following:true,is_blocked:false},true],
    ['owner',2,null,true],
    ['anonymous public',null,{is_private:false,is_following:false,is_blocked:false},true],
    ['public nonfollower',1,{is_private:false,is_following:false,is_blocked:false},true],
    ['blocked private follower',1,{is_private:true,is_following:true,is_blocked:true},false],
    ['blocked public',1,{is_private:false,is_following:false,is_blocked:true},false],
    ['missing target',1,null,false],
  ]) test(`${endpoint}: ${scenario}`, async () => {
    let handler, graphReads=0;
    const db={
      rpc: async (name,args) => {
        assert.equal(name,'get_profile_social_graph');
        assert.equal(args.p_viewer,viewer);
        assert.equal(args.p_target,2);
        assert.equal(args.p_direction,endpoint.slice(4));
        graphReads++;
        return {data:{allowed,docs:[],totalDocs:0},error:null};
      },
      from: table => {
        assert.equal(table,'follows');
        let graph=false;
        const q={select:s=>{graph=/follower:|following:/.test(s); if(graph)graphReads++;return q;},eq:()=>q,range:()=>q,in:()=>q,then:resolve=>resolve({data:[],count:0,error:null})};
        return q;
      },
    };
    load(path.join(__dirname,'..',endpoint,'index.ts'), name => {
      if(name.startsWith('https://esm.sh/'))return {createClient:()=>db};
      if(name.endsWith('verify-session.ts'))return {verifySession:async()=>viewer===null?null:'verified-user'};
      if(name.endsWith('resolve-user.ts'))return {resolveOrProvisionUser:async()=>({id:viewer})};
      throw Error(`Unexpected import ${name}`);
    }, {Deno:{serve:fn=>handler=fn,env:{get:()=> 'fixture'}}});
    const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:2,viewerUserId:2})}));
    assert.equal(response.status,allowed?200:403);
    assert.equal(graphReads,1,'authorization and data must use one RPC');
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  });
}
