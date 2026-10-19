// Isolated real-markup fixture; not an authenticated end-to-end app test.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const http = require('node:http');
const esbuild = require('esbuild');
const { chromium } = require('playwright');
const source = fs.readFileSync('packages/app/features/events/events-list.web.tsx', 'utf8');
const card = source.slice(source.indexOf('function LargeEventCard('), source.indexOf('\nfunction EventCard('));
const editor = fs.readFileSync('packages/app/features/events/event-edit.web.tsx', 'utf8');
const selector = editor.slice(editor.indexOf('          <FormField label="Event Type">'), editor.indexOf('          <FormField label="Visibility">'));
(async () => {
  const { outputFiles } = await esbuild.build({ bundle: true, write: false, format: 'iife', jsx: 'automatic', nodePaths: (process.env.NODE_PATH || '').split(require('node:path').delimiter).filter(Boolean),
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {eventTypeLabel,eventCardActionLabel,eventTypeOptions} from './packages/app/lib/events/event-type';
      const Heart=()=>null, Calendar=()=>null, MapPin=()=>null, Zap=()=>null;
      const flyerFor=()=>({}), cardDate=()=> 'Friday, Oct 30', formatLikes=String, eventEnded=e=>e.ended, EVENT_CARD_ASPECT=1.5;
      ${card}
      const FormField=({children})=><div>{children}</div>;
      function Fixture(){
        const [category,setCategory]=useState('music'); const s={category,setCategory};
        return <><section id="editor">${selector}</section>
          { [{id:'paid25',price:25,category:'party'}, {id:'paid35',price:35,category:'game_night'},
             {id:'free',price:0,category:'pool_party'}, {id:'ended',price:25,ended:true,category:'other'}].map(e=>
            <section id={e.id} key={e.id}><LargeEventCard event={{...e,title:e.id,likes:0}} onOpen={()=>window.opens=(window.opens||0)+1} onToggleLike={()=>{}} /></section>)}</>;
      } createRoot(document.getElementById('root')).render(<Fixture/>);` },
  });
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script>'+outputFiles[0].text+'</script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : fs.existsSync('/usr/bin/chromium') ? {executablePath:'/usr/bin/chromium'} : {}),args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('combobox',{name:'Event Type'}).waitFor();
    for (const [id,label,type] of [['paid25','$25','Party'],['paid35','$35','Game Night'],['free','RSVP','Pool Party'],['ended','Ended','Other']]) {
      const area=page.locator('#'+id);assert.ok((await area.innerText()).includes(type));
      assert.equal(await area.locator('span').last().innerText(),label);
      await area.getByRole('button').first().click();
    }
    assert.equal(await page.evaluate(()=>window.opens),4);
    const select=page.getByRole('combobox',{name:'Event Type'});
    assert.equal(await select.inputValue(),'music');
    const values=await select.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(Boolean));
    assert.equal(values.length,28); // 27 canonical plus preserved legacy Music
    for (const value of values.filter(v=>v!=='music')) {await select.selectOption(value);assert.equal(await select.inputValue(),value);}
    await select.selectOption('game_night');await select.selectOption('party');await select.selectOption('game_night');
    assert.equal(await select.inputValue(),'game_night');
    assert.deepEqual(errors,[]);
    console.log('PASS: actual large-card markup: paid $25/$35, free RSVP, Ended; friendly types; four card navigations; actual web editor selector: legacy retention, all 27 choices and repeated changes.');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
