// Local-only synthetic visual fixture. Never connects to an account or room.
const path=require('node:path');const fs=require('node:fs');const http=require('node:http');
const root=path.resolve(__dirname,'..');const {build}=require('esbuild');
(async()=>{
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {PreJoinSetup} from './packages/app/features/sneaky-lynk/ui/web/PreJoinSetup';
  import {useRoomUIStore} from './packages/app/features/sneaky-lynk/stores/room-ui-store';
  const params=new URLSearchParams(location.search);const width=params.get('width');
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>Promise.reject(Object.assign(new Error('fixture'),{name:params.get('error')||'NotAllowedError'}))}});
  if(!params.has('error'))useRoomUIStore.getState().setJoinCameraOn(false);
  createRoot(document.getElementById('root')).render(<main style={width?{width:Number(width),margin:'0 auto',minHeight:'100dvh'}:undefined} className="flex min-h-dvh flex-col bg-[#06070d] text-white">
    <header className="flex min-h-16 items-center border-b border-white/10 px-4"><button aria-label="Back" className="h-11 w-11 rounded-xl bg-white/10">←</button><span className="flex-1 text-center text-sm font-semibold">A room for friends</span><span className="w-11"/></header>
    <PreJoinSetup roomTitle={params.has('long')?'A very long room title for friends who are joining from their phones tonight':'A room for friends'} roomHasVideo={!params.has('audio')} onJoin={(_anon,prepare)=>{prepare();document.getElementById('joined').textContent='Local fixture joined; no real room.'}}/>
    <output id="joined"/>
  </main>);
 `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"'}});
 const tw=path.dirname(require.resolve('tailwindcss/package.json'));
 const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(`@import "${tw}/theme.css" layer(theme);@import "${tw}/preflight.css" layer(base);@import "${tw}/utilities.css" important;@source "${root}/packages/app/features/sneaky-lynk";`,{from:path.join(root,'lynk-prejoin-fixture.css')});
 const html='<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;font-family:system-ui;background:#06070d}'+css.css+'</style><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script></html>';
 fs.mkdirSync('/tmp/lynk-prejoin-visual',{recursive:true});fs.writeFileSync('/tmp/lynk-prejoin-visual/after.html',html);
 const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});server.listen(4178,'0.0.0.0',()=>console.log('Synthetic prejoin fixture http://localhost:4178'));
})().catch(e=>{console.error(e);process.exitCode=1});
