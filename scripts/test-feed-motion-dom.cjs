// Production React hook against a DOM; media decoding is deliberately mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
(async()=>{
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const observers=[];
  global.IntersectionObserver=class {
    constructor(cb){this.cb=cb;this.disconnected=false;observers.push(this)}
    observe(video){this.video=video}
    disconnect(){this.disconnected=true}
    visible(value){this.cb([{isIntersecting:value,intersectionRatio:value?1:0}])}
  };
  window.HTMLMediaElement.prototype.play=function(){this.isPlaying=true;return Promise.resolve()};
  window.HTMLMediaElement.prototype.pause=function(){this.isPlaying=false};
  const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'feed-motion-dom-'));
  try {
    await build({stdin:{contents:`
      import React, {act} from 'react'; import {createRoot} from 'react-dom/client';
      import {useFeedVideo} from './packages/app/components/feed/use-feed-video.web';
      import {useStoryViewerStore} from './packages/app/lib/stores/story-viewer-store';
      function Tile({src}){const p=useFeedVideo(src);return <><video ref={p.ref} src={src} muted={p.muted}/><button onClick={p.toggleSound}>sound</button></>}
      export {act,useStoryViewerStore};
      export function mount(node){const root=createRoot(node);return {render:(src)=>root.render(<Tile src={src}/>),unmount:()=>root.unmount()}}
    `,resolveDir:root,loader:'tsx'},bundle:true,nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),platform:'node',format:'cjs',outfile:path.join(dir,'hook.cjs'),jsx:'automatic',alias:{'@dvnt/app':path.join(root,'packages/app')}});
    const {act,mount,useStoryViewerStore}=require(path.join(dir,'hook.cjs'));
    const node=document.createElement('div');document.body.append(node);
    const app=mount(node);await act(async()=>app.render('first.mp4'));
    let video=document.querySelector('video');
    assert.notEqual(video.isPlaying,true);
    await act(async()=>observers.at(-1).visible(true));assert.equal(video.isPlaying,true);
    await act(async()=>document.querySelector('button').click());assert.equal(video.muted,false);
    await act(async()=>useStoryViewerStore.setState({open:true}));assert.equal(video.isPlaying,false);
    await act(async()=>useStoryViewerStore.setState({open:false}));assert.equal(video.isPlaying,true);
    await act(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new window.Event('visibilitychange'))});assert.equal(video.isPlaying,false);
    await act(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new window.Event('visibilitychange'))});assert.equal(video.isPlaying,true);
    const old=observers.at(-1);await act(async()=>app.render('second.mp4'));assert.equal(old.disconnected,true);assert.equal(video.isPlaying,false);
    await act(async()=>observers.at(-1).visible(true));assert.equal(video.isPlaying,true);
    await act(async()=>observers.at(-1).visible(false));assert.equal(video.isPlaying,false);
    await act(async()=>observers.at(-1).visible(true));
    await act(async()=>app.unmount());assert.equal(video.isPlaying,false);assert.equal(observers.at(-1).disconnected,true);
    console.log('PASS production hook: intersection, story, background, source replacement, unmount and sound controls (mocked media).');
  }finally{window.happyDOM.abort();fs.rmSync(dir,{recursive:true,force:true})}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
