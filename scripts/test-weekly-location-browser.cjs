/** Production web CityVisibilitySection and shared MemberDistanceBadge rendered
 * through real React Native Web in Chromium. API, auth, storage and device
 * observations are synthetic. Not deployed Next/backend E2E or a CSS audit.
 * --build-only compiles both bundles without starting a browser.
 */
const assert = require('node:assert/strict');
const { buildBrowserFixture: settingsBundle } = require('./test-member-proximity-settings-dom.cjs');
const { buildBrowserFixture: distanceBundle } = require('./test-weekly-location-dom.cjs');
(async () => {
  const settings = await settingsBundle();
  const distances = await distanceBundle({realWebHost:true});
  if (process.argv.includes('--build-only')) {
    console.log('PASS weekly location browser bundles build; Chromium assertions NOT executed');
    return;
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  try {
    for (const width of [390,1280]) {
      const page = await browser.newPage({viewport:{width,height:844}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>route.abort());
      await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
      await page.evaluate(()=>Object.assign(window,{saved:{},failRead:false,native:false,duplicate:false,calls:[],samples:0,active:0,maxConcurrent:0}));
      await page.addScriptTag({content:settings});
      const button=name=>page.getByRole('button',{name,exact:true});
      const switches=page.getByRole('switch');
      await button('I agree: allow exact distances').waitFor();
      assert.equal(await button('I agree: allow exact distances').isDisabled(),true);
      await switches.nth(0).click();
      assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='publish').length),0,'city-only opt-in never publishes coordinates');
      await switches.nth(1).click();
      await page.waitForFunction(()=>calls.filter(c=>c.action==='publish').length===1);
      await page.evaluate(()=>{window.fail='publish';window.holdSample=true;});
      await button('I agree: allow exact distances').click();
      await page.waitForFunction(()=>samples===1);
      await button('Getting a fresh location…').waitFor();
      await page.evaluate(()=>window.resolveSample());
      await button('Retry distance sharing').waitFor();
      assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='consentExact').length),1);
      assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='publish').at(-1).value.exactDistanceVersion),2);
      const sample=await page.evaluate(()=>calls.filter(c=>c.action==='publish').at(-1).value.observedAt);
      await page.evaluate(()=>window.fail=null);
      await button('Retry distance sharing').click();
      await page.waitForFunction(()=>calls.filter(c=>c.action==='publish').length===3);
      await button('Retry distance sharing').waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='publish').at(-1).value.observedAt),sample);
      assert.equal(await page.evaluate(()=>samples),1,'retry does not silently sample again');
      await page.evaluate(()=>window.fail='revokeExact');
      await button('Stop exact distances').click();
      await button('Retry Stop exact distances').waitFor();
      await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry Stop exact distances')?.disabled);
      await page.evaluate(()=>window.fail=null);
      await button('Retry Stop exact distances').click();
      await page.waitForFunction(()=>!exact.getState().pendingWithdrawals.a);
      await button('I agree: allow exact distances').waitFor();
      await page.waitForFunction(()=>active===0);
      const beforeOrdinaryStop=await page.evaluate(()=>calls.filter(c=>c.action==='publish').length);
      await page.evaluate(()=>window.fail='revoke');
      await switches.nth(1).click();
      await button('Retry Stop sharing distance').waitFor();
      assert.equal(await switches.nth(1).getAttribute('aria-checked'),'false');
      await page.evaluate(()=>{window.render({show:false});window.render();});
      await button('Retry Stop sharing distance').waitFor();
      await page.evaluate(()=>window.fail=null);
      await button('Retry Stop sharing distance').click();
      await page.waitForFunction(()=>!sync.getState().pendingWithdrawals.a);
      await button('Retry Stop sharing distance').waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>events.getState().preciseProximityGrant),false);
      assert.equal(await page.evaluate(()=>maxConcurrent),1);
      assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='publish').length),beforeOrdinaryStop,'ordinary stop/retry never republish');
      await page.evaluate(()=>closeRoot());
      assert.deepEqual(errors,[]);
      await page.close();

      const badge=await browser.newPage({viewport:{width,height:844}});
      const badgeErrors=[];badge.on('pageerror',e=>badgeErrors.push(e.message));
      await badge.route('**/*',route=>route.abort());
      await badge.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
      await badge.evaluate(()=>{window.fixture={user:{authId:'viewer',username:'viewer'},access:{owner:'viewer',hydrationReady:true,blocked:false,settings:{locationEnabled:true,sessionKey:'signin-a'}},location:{preciseProximityGrant:true,preciseProximityOwnerAuthId:'viewer',cityVisibility:{cityId:1,cityName:'City',expiresAt:Date.now()+3600000}},exact:{owner:null,sessionKey:null,expiresAt:0,generation:0},calls:0,fail:false,reply:{kind:'distance',band:'under_1',label:'0.01 miles away'}};});
      await badge.addScriptTag({content:distances});
      await badge.getByText('(Less than a mile away)',{exact:true}).first().waitFor();
      assert.equal(await badge.getByText('(Less than a mile away)',{exact:true}).count(),2);
      assert.equal(await badge.evaluate(()=>fixture.calls),1,'duplicate author badges share one query');
      assert.doesNotMatch(await badge.locator('body').innerText(),/0\.01/);
      await badge.evaluate(async()=>{fixture.reply={kind:'distance',band:'1_5',label:'A few miles away'};await fixture.query.invalidateQueries();});
      await badge.getByText('(A few miles away)',{exact:true}).first().waitFor();
      await badge.evaluate(()=>{fixture.exact={owner:'viewer',sessionKey:'signin-a',expiresAt:Date.now()+3600000,generation:1};fixture.reply={kind:'distance',consentVersion:2,miles:0.01,expiresAt:new Date(Date.now()+60000).toISOString()};dispatchEvent(new Event('fixturechange'));});
      await badge.getByText('(0.01 miles away)',{exact:true}).first().waitFor();
      await badge.evaluate(()=>{fixture.location.preciseProximityOwnerAuthId='other-account';dispatchEvent(new Event('fixturechange'));});
      await badge.waitForFunction(()=>document.getElementById('root').textContent==='');
      await badge.evaluate(()=>{fixture.location.preciseProximityOwnerAuthId='viewer';fixture.access.settings.sessionKey='replacement-signin';dispatchEvent(new Event('fixturechange'));});
      await badge.waitForFunction(()=>document.getElementById('root').textContent==='');
      await badge.evaluate(()=>{fixture.user=null;dispatchEvent(new Event('fixturechange'));});
      await badge.waitForFunction(()=>document.getElementById('root').textContent==='');
      assert.deepEqual(badgeErrors,[]);
      await badge.close();
      console.log(`PASS ${width}px Chromium direct web Settings explicit city/approximate/exact consent, fresh sample, publish retry, exact/ordinary Stop retry and remount; shared real RN-web badges coarse/exact wording, query deduplication and account/session revocation. Synthetic backend/device boundaries.`);
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
