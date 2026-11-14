// Production web map mounted with synthetic provider/location boundaries only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const root = path.resolve(__dirname, '..');
  const mocks = {
    '@dvnt/ui/google-maps-public-config': `export const getGoogleMapsPublicKey=()=> 'fixture';`,
    '@vis.gl/react-google-maps': `import React from 'react';export const APILoadingStatus={LOADED:'loaded',FAILED:'failed',AUTH_FAILURE:'auth'};export const useApiLoadingStatus=()=>window.f.provider||'loaded';export const useMap=()=>null;export const useMapsLibrary=()=>null;export const APIProvider=({children})=>children;export const Map=({children})=><div data-map>{children}</div>;`,
    '@dvnt/app/lib/stores/events-location-store': `export const useEventsLocationStore=selector=>selector({activeCity:null});`,
    'solito/navigation': `export const useRouter=()=>({push:()=>{}});`,
    '@dvnt/app/features/settings/ui/LocationControls': `export const LocationControls=()=> <div data-settings>Settings controls</div>;`,
    '@dvnt/app/lib/hooks/use-member-map': `export const useLocationSettings=()=>({sharing:window.f.sharing,enabled:true,busy:false,error:window.f.stopError,needsLocationStop:!!window.f.stopError,setOverall:async value=>{window.f.overall=value},setSharing:async value=>{window.f.stops++;window.f.sharing=value;window.render()},refresh:async()=>{}});export const useMemberMapPresence=()=>({area:null,error:'Your device location needs confirmation',isUpdating:false,requestLocation:async()=>window.f.requests++});export const useNearbyMembers=()=>({data:null,isError:false,isPending:false});`,
  };
  const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import MemberMap from './packages/app/features/events/ui/member-map.web.tsx';const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<MemberMap/>);window.unmount=()=>root.unmount();window.render();`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',nodePaths:[process.env.NODE_PATH],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:root}));}}]});
  const win=new Window({console,url:'https://dvnt.test/events',settings:{enableJavaScriptEvaluation:true}});
  const tick=()=>new Promise(r=>setTimeout(r,25));
  const button=text=>[...win.document.querySelectorAll('button')].find(b=>b.textContent===text);
  try {
    win.document.body.innerHTML='<div id="root"></div>';win.f={sharing:false,requests:0,stops:0};win.eval(result.outputFiles[0].text);
    for(let i=0;i<100&&!win.document.querySelector('[data-map]');i++) await tick();
    assert.ok(win.document.querySelector('[data-map]'));
    assert.equal(win.document.querySelector('[aria-label="Events and people map"]').firstElementChild.getAttribute('aria-label'),'Event flyers and approximate member locations','map is first, not a warning or consent block');
    assert.equal(win.document.body.textContent.includes('Your device location needs confirmation'),false);
    assert.equal(win.document.body.textContent.includes('Show my avatar'),false);
    assert.equal(win.document.body.textContent.includes('Turn on avatar sharing'),false);
    assert.equal(win.document.querySelector('[data-settings]'),null);
    assert.equal(win.f.requests,0,'rendering does not request permission');
    for(let attempt=0;attempt<2;attempt++) {
      const details=win.document.querySelector('details');details.open=true;details.dispatchEvent(new win.Event('toggle'));await tick();
      assert.ok(win.document.querySelector('[data-settings]'));
      assert.ok(win.document.body.textContent.includes('Your device location needs confirmation'));
      button('Update my location').click();await tick();
      details.open=false;details.dispatchEvent(new win.Event('toggle'));await tick();
      assert.equal(button('Update my location'),undefined);
      assert.equal(win.document.querySelector('[data-settings]'),null,'closing discards optional settings UI');
    }
    assert.equal(win.f.requests,2);
    let details=win.document.querySelector('details');details.open=true;details.dispatchEvent(new win.Event('toggle'));await tick();
    win.f.provider='failed';win.render();await tick();assert.equal(win.document.querySelector('[data-map]'),null);
    win.f.provider='loaded';win.render();await tick();assert.equal(win.document.querySelector('details').open,true,'provider recovery preserves disclosure state and visible errors');
    details=win.document.querySelector('details');details.open=false;details.dispatchEvent(new win.Event('toggle'));await tick();
    win.f.sharing=true;win.render();await tick();button('Stop sharing').click();await tick();
    assert.equal(win.f.stops,1);assert.equal(win.f.sharing,false);assert.ok(win.document.querySelector('[data-map]'),'opt-out preserves public map');
    win.f.stopError='Could not confirm withdrawal';win.render();await tick();assert.match(win.document.querySelector('[role="alert"]').textContent,/Could not confirm/,'withdrawal failures stay visible without settings');
    button('Turn all location off').click();await tick();assert.equal(win.f.overall,false,'withdrawal failure exposes a real recovery action');
    console.log('PASS: map-first, no duplicate consent, explicit repeated recovery, stop sharing, and withdrawal error visibility');
  } finally { win.unmount?.();await win.happyDOM.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
