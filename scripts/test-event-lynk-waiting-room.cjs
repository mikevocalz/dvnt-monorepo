#!/usr/bin/env node
// Real shared waiting hook + API with synthetic transport/session boundaries.
// Exercise terminal refusals, retry, admission once, and interrupted navigation.
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const paths = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), ROOT];
const load = name => require(require.resolve(name, { paths }));
const reactAliases = Object.fromEntries(['react', 'react-dom'].map(name => [name, path.dirname(require.resolve(`${name}/package.json`, { paths }))]));

async function exercise() {
  const f = window.fixture;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate) => { const end = Date.now() + 3000; while (!predicate()) {
    check(Date.now() < end, 'waiting fixture reached expected state'); await sleep(5);
  } };
  const next = async () => { await until(() => f.pending.length); return f.pending.shift(); };
  const count = () => f.admitted.length + f.refused.length;
  await next().then(p => p.resolve({ data: { state: 'scheduled', admitted: false } }));
  await next().then(p => p.resolve({ error: { status: 500, message: 'Could not verify event ticket' } }));
  await next().then(p => p.resolve({ data: { state: 'live', admitted: true } }));
  await until(() => f.admitted.length === 1);
  check(f.refused.length === 0, 'network/read failures stay retryable even when copy contains ticket');
  const admittedCalls = f.calls.length;
  await sleep(40);
  check(f.calls.length === admittedCalls, 'admission fires once and stops polling');

  for (const [status, message] of [[409, 'This event is no longer available'], [403, 'Admission removed'],
    [401, 'Unauthorized'], [404, 'Event Lynk not found'], [409, 'This Lynk has ended']]) {
    f.serial++; f.render();
    const before = f.refused.length;
    await next().then(p => p.resolve({ error: { status, message } }));
    await until(() => f.refused.length === before + 1);
    check(f.refused.at(-1).message === message, 'preserve actionable refusal copy');
    const calls = f.calls.length;
    await sleep(40);
    check(f.calls.length === calls, `HTTP ${status} stops polling`);
    check(document.getElementById('root').textContent === message, 'refusal leaves waiting screen');
  }
  f.serial++; f.render();
  const oldRoom = await next();
  f.roomId = 'event-room-b'; f.render();
  const newRoom = await next();
  const beforeSwitch = count();
  oldRoom.resolve({ data: { state: 'live', admitted: true } });
  await sleep(20);
  check(count() === beforeSwitch, 'late response from old event cannot admit the current room');
  newRoom.resolve({ data: { state: 'live', admitted: true } });
  await until(() => count() === beforeSwitch + 1);
  check(f.admitted.at(-1) === 'event-room-b', 'admission targets the exact new event room');

  f.serial++; f.render();
  const staleSession = await next();
  const beforeSession = count();
  f.epoch++;
  staleSession.resolve({ data: { state: 'live', admitted: true } });
  await sleep(40);
  check(count() === beforeSession, 'old session response cannot admit a new account');
  check(f.pending.length === 0, 'session change stops old polling');

  f.serial++; f.render();
  const unmounted = await next();
  const beforeUnmount = count();
  f.unmount();
  unmounted.resolve({ error: { status: 409, message: 'This event is no longer available' } });
  await sleep(40);
  check(count() === beforeUnmount, 'unmounted response cannot change navigation or error state');
  check(f.calls.every(call => call.name === 'event-lynk-room' && call.body.action === 'wait'), 'heartbeats only use event admission endpoint');
  return f.calls.length;
}

(async () => {
  const boundaries = new Map([
    ['fixture', `export const f=window.fixture={epoch:1,serial:0,roomId:'event-room-a',pending:[],calls:[],admitted:[],refused:[]};
      export const invokeEdge=(name,body)=>new Promise(resolve=>{f.calls.push({name,body});f.pending.push({resolve});});
      export const getSessionLifecycle=()=>({epoch:f.epoch,ready:true});`],
    ['@dvnt/app/lib/auth/session-lifecycle', `export {getSessionLifecycle} from 'fixture';`],
    ['./invoke-edge', `export {invokeEdge} from 'fixture';`],
  ]);
  const built = await load('esbuild').build({ stdin: { resolveDir: ROOT, loader: 'tsx', contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{f}from'fixture';
    import{useEventLynkWaitingRoom}from'./packages/app/features/sneaky-lynk/hooks/useEventLynkWaitingRoom';
    const originalTimeout=window.setTimeout.bind(window);
    window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===5000?10:ms,...args);
    function App(){const[text,setText]=useState('Waiting for host');const roomId=f.roomId;
      useEventLynkWaitingRoom({roomId,enabled:true,onAdmitted:()=>{f.admitted.push(roomId);setText('Admitted');},
        onRefused:message=>{f.refused.push({roomId,message});setText(message);}});return <p>{text}</p>;}
    const root=createRoot(document.getElementById('root'));f.render=()=>root.render(<App key={f.serial}/>);
    f.unmount=()=>root.unmount();f.render();` }, bundle: true, write: false, alias: reactAliases, platform: 'browser', format: 'iife',
    jsx: 'automatic', nodePaths: paths, define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (boundaries.has(args.path)) return { path: args.path, namespace: 'fixture' };
        if (args.path.startsWith('@dvnt/app/')) return b.resolve(path.join(ROOT, 'packages/app', args.path.slice(10)), { resolveDir: ROOT, kind: args.kind });
      });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: boundaries.get(args.path), loader: 'tsx', resolveDir: ROOT }));
    } }] });
  if (process.argv.includes('--browser')) {
    const name = process.env.LYNK_BROWSER || 'chromium';
    const browser = await load('playwright')[name].launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = []; page.on('pageerror', error => errors.push(String(error)));
      await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: built.outputFiles[0].text });
      await page.evaluate(exercise); assert.deepEqual(errors, []);
      console.log(`PASS event waiting-room hook and API in ${name}: refusal, retry, exact room, session/unmount cancellation. Synthetic boundaries only.`);
    } finally { await browser.close(); }
  } else {
    const dom = new (load('jsdom').JSDOM)('<div id="root"></div>', { url: 'https://fixture.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
    try { dom.window.eval(built.outputFiles[0].text); await dom.window.eval(`(${exercise.toString()})()`);
      console.log('PASS event waiting-room hook and API: refusal, retry, exact room, session/unmount cancellation. Synthetic jsdom, not live media/device acceptance.');
    } finally { dom.window.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
