const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const React=require('react'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom'),ts=require('typescript');
test('public guest checkout hides chrome without remounting checkout; closing and other routes restore it',async()=>{
 const dom=new JSDOM('<div id="root"></div>');global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 let pathname='/public/events/83',open=false,eventId='83',mounts=0;
 const mocks={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'next/dynamic':{default:fn=>()=>React.createElement('span',{'data-chrome':String(fn).includes('GlassHeader')?'header':'footer'})},'solito/navigation':{usePathname:()=>pathname},'@dvnt/app/lib/stores/auth-store':{useAuthStore:fn=>fn({isAuthenticated:false,_hasHydrated:true})},'@dvnt/app/lib/stores/guest-checkout-store':{useGuestCheckoutStore:fn=>fn({open,eventId})},'@dvnt/app/components/app-shell':{AppShell:({children})=>children},'@dvnt/app/lib/web-chrome':{routeIsImmersive:()=>false},'@/components/chrome-error-boundary':{ChromeErrorBoundary:({children})=>children}};
 const source=fs.readFileSync(path.join(__dirname,'../apps/web/src/components/site-chrome.tsx'),'utf8');const exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:n=>{assert.ok(mocks[n],n);return mocks[n]},setInterval,clearInterval});
 const root=createRoot(document.getElementById('root'));
 function Checkout(){React.useEffect(()=>{mounts++},[]);return React.createElement('input',{defaultValue:'preserved buyer'})}
 const render=()=>React.act(async()=>root.render(React.createElement(exports.SiteChrome,null,React.createElement(Checkout))));
 try{await render();assert.equal(document.querySelectorAll('[data-chrome]').length,2);
 open=true;await render();assert.equal(document.querySelectorAll('[data-chrome]').length,0);assert.equal(mounts,1);assert.equal(document.querySelector('input').value,'preserved buyer');
 pathname='/public/events/84';await render();assert.equal(document.querySelectorAll('[data-chrome]').length,2);
 pathname='/blog';await render();assert.equal(document.querySelectorAll('[data-chrome]').length,2);
 pathname='/public/events/83';open=false;await render();assert.equal(document.querySelectorAll('[data-chrome]').length,2);assert.equal(mounts,1);
 }finally{await React.act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;}
});
