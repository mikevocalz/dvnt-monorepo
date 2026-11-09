const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const React = require('react');
const {createRoot} = require('react-dom/client');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<div id="root"></div>');
Object.assign(global, {window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true});
const file = 'packages/app/features/events/use-review-section.web.ts';
const mod = new Module(file, module); mod.paths = module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
const {useReviewSection} = mod.exports;
let scrolled = 0;
dom.window.HTMLElement.prototype.scrollIntoView = function(){ assert.equal(this.id, 'reviews'); scrolled++; };
function Detail({id, requested, ready}) {
  const ref = useReviewSection(id, requested, ready);
  return ready ? React.createElement('div', {id:'reviews', ref, tabIndex:-1}, 'Ratings & Reviews') : React.createElement('div',null,'Loading');
}
(async()=>{
  const root = createRoot(document.getElementById('root'));
  const render = async (id,requested,ready)=>React.act(async()=>root.render(React.createElement(Detail,{id,requested,ready})));
  await render(null,true,true); assert.equal(scrolled,0, "unresolved event must not scroll");
  await render(82,true,false); assert.equal(scrolled,0);
  await render(82,true,true); assert.equal(scrolled,1); assert.equal(document.activeElement.id,'reviews');
  await render(82,true,true); assert.equal(scrolled,1, 'rerenders must not hijack reading');
  await render(82,false,true); assert.equal(scrolled,1);
  await render(82,true,true); assert.equal(scrolled,2,'back to section works');
  await render(85,true,false); assert.equal(scrolled,2);
  await render(85,true,true); assert.equal(scrolled,3,'new event waits for its content');
  await React.act(async()=>root.unmount());
  const source = fs.readFileSync('packages/app/features/events/event-detail.web.tsx','utf8');
  assert.match(source, /id="reviews" ref={reviewSectionRef}/);
  assert.match(source, /useReviewSection\(resolvedId, requestedReviews, !!full\)/);
  assert.match(source, /<Section title="Ratings & Reviews"/);
  console.log('PASS: existing section async scroll/focus, stable rerender, history return and event changes');
})().catch(e=>{console.error(e);process.exitCode=1;});
