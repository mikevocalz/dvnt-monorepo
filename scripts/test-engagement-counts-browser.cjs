#!/usr/bin/env node
// Real shared web controls + Tailwind in Chromium. No live API writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { compile } = require('tailwindcss');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const source = `import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {PostEngagementCounts} from './packages/ui/src/social/PostEngagementCounts.web';
    import {Send,Bookmark} from 'lucide-react';
    function Fixture(){
      const [likes,setLikes]=useState(0),[comments,setComments]=useState(0);
      window.setCounts=(l,c)=>{setLikes(l);setComments(c)};
      window.calls={likes:0,comments:0};
      return <div className="p-3 bg-black min-h-screen text-white"><div className="grid grid-cols-2 gap-2 max-w-[600px]">
        {[0,1].map(i=><div key={i} data-card className="rounded-2xl bg-slate-800 pt-24">
          <div data-row className="relative flex flex-wrap items-center justify-between gap-x-1 px-1">
            <PostEngagementCounts compact likes={likes} comments={comments} hasLiked={likes>0}
              onLike={()=>setLikes(v=>v?0:1)} onViewLikes={()=>window.calls.likes++} onComments={()=>window.calls.comments++}/>
            <button aria-label="Reshare post" className="flex min-h-11 min-w-6 items-center justify-center"><Send size={14}/></button>
            <button aria-label="Bookmark" className="flex min-h-11 min-w-6 items-center justify-center"><Bookmark size={14}/></button>
          </div>
        </div>)}
      </div><div className="mt-8"><PostEngagementCounts likes={likes} comments={comments} hasLiked={likes>0}
        onLike={()=>setLikes(v=>v?0:1)} onViewLikes={()=>window.calls.likes++} onComments={()=>window.calls.comments++}/></div></div>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);`;
  const bundled = await build({stdin:{contents:source,loader:'tsx',resolveDir:ROOT},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},define:{'process.env.NODE_ENV':'"test"'},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),alias:{'@dvnt/app':path.join(ROOT,'packages/app')}});
  const component=fs.readFileSync(path.join(ROOT,'packages/ui/src/social/PostEngagementCounts.web.tsx'),'utf8');
  const candidates=[...new Set((source+component).match(/[A-Za-z0-9_:[\]#./%-]+/g))];
  const twRoot=path.dirname(require.resolve('tailwindcss/package.json'));
  const compiled=await compile(fs.readFileSync(path.join(twRoot,'theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(twRoot,'preflight.css'),'utf8')+'\n@tailwind utilities;');
  const css=compiled.build(candidates);
  const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundled.outputFiles[0].contents);}else{res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox']});
    const page=await browser.newPage();
    for(const width of [320,375,768,1280]) {
      await page.setViewportSize({width,height:800});
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.getByRole('button',{name:'View 0 likes',exact:true}).first().waitFor();
      for(const [likes,comments] of [[0,0],[1,1],[1250,45],[999999,1234567]]) {
        await page.evaluate(([l,c])=>window.setCounts(l,c),[likes,comments]);
        await page.getByRole('button',{name:`View ${likes} ${likes===1?'like':'likes'}`,exact:true}).first().waitFor();
        const boxes=await page.evaluate(()=>[...document.querySelectorAll('[data-card]')].map(card=>{
          const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
          const pair=card.querySelector('[data-like-count-pair]');
          return {card:rect(card),buttons:[...card.querySelectorAll('button')].map(rect),pair:[...pair.children].map(rect)};
        }));
        for(const box of boxes) {
          assert.equal(box.pair[0].y,box.pair[1].y,'heart/count share the same row');
          assert(box.pair[1].x-box.pair[0].right<=3,'count stays immediately beside heart');
          for(const b of box.buttons) {
            assert(b.width>=24 && b.height>=44, `compact controls retain at least 24x44px targets at ${width}: ${JSON.stringify(b)}`);
            assert(b.x>=box.card.x && b.right<=box.card.right+1,`no clipped button at ${width}: ${JSON.stringify(box)}`);
          }
          for(let i=0;i<box.buttons.length;i++) for(let j=i+1;j<box.buttons.length;j++) {
            const a=box.buttons[i],b=box.buttons[j];
            assert(a.right<=b.x+1 || b.right<=a.x+1 || a.bottom<=b.y+1 || b.bottom<=a.y+1,'action targets must not overlap');
          }
        }
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scrolling');
      }
      await page.evaluate(()=>window.setCounts(0,0));
      const like=page.getByRole('button',{name:'Like',exact:true}).first();
      await like.click();
      await page.getByRole('button',{name:'View 1 like',exact:true}).first().waitFor();
      const count=page.getByRole('button',{name:'View 1 like',exact:true}).first();
      await count.focus();await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>window.calls.likes),1,'keyboard count activation opens likers independently');
      await page.getByRole('button',{name:'View 0 comments',exact:true}).first().click();
      assert.equal(await page.evaluate(()=>window.calls.comments),1,'comment icon/count action works');
      await page.getByRole('button',{name:'Unlike',exact:true}).first().click();
      await page.getByRole('button',{name:'View 0 likes',exact:true}).first().waitFor();
      if(process.env.ENGAGEMENT_EVIDENCE_DIR){fs.mkdirSync(process.env.ENGAGEMENT_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.ENGAGEMENT_EVIDENCE_DIR,`engagement-${width}.png`),fullPage:true});}
    }
    console.log('PASS Chromium: 320/375/768/1280px; zero/singular/large counts, adjacency, no clipping/overlap, keyboard likers, comments and repeated like/unlike');
  } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1});
