const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const render=(file,exportName,pathname)=>{
 const calls=[];const router={push:route=>calls.push(['route',route]),navigate:route=>calls.push(['route',route])};
 const feed={triggerScrollToTop:()=>calls.push(['top'])};
 const app={setNsfwEnabled:(value)=>calls.push(['sweet',value])};
 const useFeedScrollStore=Object.assign(fn=>fn(feed),{getState:()=>feed});
 const exports={};
 const jsx=(type,props)=>({type,props});
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,require:name=>name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-native'?{View:'view',Pressable:'button',StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390})}:name.includes('app-store')?{useAppStore:{getState:()=>app}}:name.includes('feed-scroll-store')?{useFeedScrollStore}:name.includes('auth-store')?{useAuthStore:{getState:()=>({user:{id:'me'}})}}:name==='expo-router'||name==='solito/navigation'?{useRouter:()=>router,usePathname:()=>pathname}:name.includes('use-messages')?{useUnreadMessageCount:()=>({data:0})}:name.includes('unread-badge')?{unreadAccessibilityLabel:()=>''}:{}
 });
 const tree=exports[exportName]();
 const find=node=>node?.type==='button'&&node.props.accessibilityLabel==='Sweet feed, back to top'?node:Array.isArray(node?.props?.children)?node.props.children.map(find).find(Boolean):findChild(node?.props?.children);
 const findChild=node=>node?find(node):undefined;
 const button=find(tree);assert.ok(button);return {calls,press:button.props.onPress};
};
for(const [file,name,home,other,route] of [
 ['packages/app/components/tab-header.tsx','TabHeaderLogo','/','/events','/(protected)/(tabs)'],
 ['packages/app/components/web-app-header.web.tsx','WebAppHeader','/feed','/notifications','/feed']
]){
 const active=render(file,name,home);active.press();active.press();assert.deepEqual(active.calls,[['sweet',false],['top'],['sweet',false],['top']]);
 const away=render(file,name,other);away.press();assert.deepEqual(away.calls,[['sweet',false],['top'],['route',route]]);
}
console.log('PASS actual native/web logo handlers: Sweet before reset, repeated Home taps without duplicate history, navigation from another tab');
