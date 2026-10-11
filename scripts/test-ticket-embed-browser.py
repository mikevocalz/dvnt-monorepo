#!/usr/bin/env python3
"""Exercise the checked-in loader and selection document in Chromium.
Stripe and upstream responses are explicit test doubles. This is NOT a sandbox payment test.
"""
import json, os, subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
SITE, HOST = 'https://dvntapp.live', 'https://events.example.com'
EMBED, TIER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
CHANNEL = '11111111-1111-4111-8111-111111111111'
data = {'embedId':EMBED,'allowedOrigin':HOST,'revision':1,'siteOrigin':SITE,
        'event':{'id':90,'title':'Example event','startDate':'2026-10-12T20:00:00Z','timeZone':'America/New_York','location':'New York','flyerUrl':SITE+'/fixture.png','attendeeNamesRequired':False},
        'tiers':[{'id':TIER,'name':'General Admission','priceCents':2500,'maxQuantity':10,'available':20}]}
render = subprocess.run(['node',str(ROOT/'scripts/render-ticket-embed-test.cjs')],input=json.dumps({'data':data,'channel':CHANNEL}),text=True,capture_output=True,check=True).stdout
loader = (ROOT/'apps/web/public/embed/tickets.js').read_text()
client = (ROOT/'apps/web/public/embed/widget-client.js').read_text()
logo = (ROOT/'apps/web/public/dvnt-wordmark.svg').read_text()
passed=[]
def check(name, assertion):
    assert assertion, name
    passed.append(name)
STRIPE_STUB = '''window.Stripe = function(key) {return {initEmbeddedCheckout: async function(options) {
  window.__stripeSecret = await options.fetchClientSecret();
  return {mount: function(target) { window.__stripeTopLevel = target.ownerDocument === document && window.top === window;
    const b=document.createElement('button');b.textContent='Pay test card';b.onclick=()=>options.onComplete();target.append(b);},
    destroy: function(){}};}};'''
with sync_playwright() as p:
    options = {'headless':True}
    if os.environ.get('DVNT_CHROMIUM_EXECUTABLE'):
        options['executable_path']=os.environ['DVNT_CHROMIUM_EXECUTABLE']
    browser = p.chromium.launch(**options)
    context = browser.new_context(viewport={'width':1280,'height':900})
    page = context.new_page()
    errors, calls, messages = [], [], []
    state = {'fulfilled':False,'paid':False,'cancel_failure':False,'lost':False,'attempts':{},'requests':[], 'unexpected':[]}
    page.on('pageerror',lambda error: errors.append(str(error)))
    def route(request_route):
        request=request_route.request;u=urlparse(request.url)
        cors={'Access-Control-Allow-Origin':HOST,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type'}
        def respond(body,code=200):
            request_route.fulfill(status=code,content_type='application/json',headers=cors,body=json.dumps(body))
        if request.url.startswith(HOST):
            request_route.fulfill(content_type='text/html',body=f'''<!doctype html><style>body{{margin:0;background:white}}#host-button{{background:rgb(91,23,67);font-size:17px;color:white}}</style>
            <button id="host-button" onclick="window.hostClicks=(window.hostClicks||0)+1">Host purchase control</button>
            <div id="embed" style="width:1100px;max-width:100%" data-dvnt-ticket-embed="{EMBED}"></div>
            <script>window.seenMessages=[];window.addEventListener('message',e=>window.seenMessages.push(e.data));</script>
            <script async src="{SITE}/embed/tickets.js"></script>''');return
        if request.url=='https://js.stripe.com/v3/':
            request_route.fulfill(content_type='application/javascript',body=STRIPE_STUB);return
        if u.path=='/embed/tickets.js':request_route.fulfill(content_type='application/javascript',body=loader);return
        if u.path=='/embed/widget-client.js':request_route.fulfill(content_type='application/javascript',body=client);return
        if u.path=='/dvnt-wordmark.svg':request_route.fulfill(content_type='image/svg+xml',body=logo);return
        if u.path=='/fixture.png':
            request_route.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="450" height="550"><rect width="450" height="550" fill="#242036"/></svg>');return
        if u.path.startswith('/embed/tickets/'):
            channel=parse_qs(u.query)['channel'][0]
            headers={'Content-Security-Policy':f"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors {HOST}"}
            request_route.fulfill(content_type='text/html',headers=headers,body=render.replace(CHANNEL,channel));return
        if u.path=='/embed/api':
            if request.method=='OPTIONS':request_route.fulfill(status=204,headers=cors);return
            body=request.post_data_json;calls.append(body);state['requests'].append(request.headers)
            action=body['action']
            totals={'subtotal':2500,'serviceFee':163,'total':2663,'discount':0,'currency':'usd'}
            if action=='quote':respond({'totals':totals,'quoteHash':'a'*64});return
            attempt_id=body.get('attemptId')
            if action=='checkout':
                state['attempts'].setdefault(attempt_id,{'token':body['token']})
                if state['lost']:
                    state['lost']=False;respond({'error':'Test response lost. Retry to recover.','code':'retry_same_attempt'},503);return
            if action=='cancel':
                if state['cancel_failure']:respond({'error':'Provider cancellation outcome unknown.'},503);return
                respond({'state':'expired'});return
            if action in ['checkout','resume']:
                respond({'state':'payment_open','clientSecret':'fixture_payment_secret','publishableKey':'pk_test_fixture','totals':totals});return
            if action=='status':
                state['paid']=True
                if not state['fulfilled']:respond({'state':'paid_issuing'});return
                respond({'state':'fulfilled','tickets':[{'url':SITE+'/public/tickets/guest/dddddddd-dddd-4ddd-8ddd-dddddddddddd'}],'emailStatus':'sent'});return
            respond({'error':'Unknown fixture action'},400);return
        state['unexpected'].append(request.url);request_route.abort()
    page.route('**/*',route)
    page.goto(HOST,wait_until='domcontentloaded')
    frame=page.frame_locator('#embed iframe')
    expect(frame.get_by_role('heading',name='Select tickets')).to_be_visible()
    expect(frame.locator('#quantity')).to_have_value('1')
    baseline=page.locator('#host-button').evaluate('(el)=>[getComputedStyle(el).backgroundColor,getComputedStyle(el).fontSize]')
    for width in [320,390,739,740,760,1100]:
        page.locator('#embed').evaluate('(el,w)=>el.style.width=w+"px"',width)
        page.wait_for_timeout(80)
        rects=frame.locator('main').evaluate('(el)=>({columns:getComputedStyle(el).gridTemplateColumns.split(" ").length,scroll:document.documentElement.scrollWidth,width:window.innerWidth})')
        check(f'{width}px breakpoint',rects['columns']==(2 if width>=740 else 1))
        check(f'{width}px no horizontal overflow',rects['scroll']<=rects['width'])
    check('SVG header and footer are both images, not substituted text',frame.locator('img[alt="DVNT"]').count()==2)
    check('footer text-only offset preserved',frame.locator('footer span').evaluate('(el)=>getComputedStyle(el).top')=='12px')
    check('full event fallback remains available',frame.get_by_role('link',name='open the full DVNT event').get_attribute('href')==SITE+'/e/90')
    page.get_by_role('button',name='Host purchase control').click()
    check('host purchase control unchanged',page.evaluate('window.hostClicks')==1)
    check('host CSS unchanged',page.locator('#host-button').evaluate('(el)=>[getComputedStyle(el).backgroundColor,getComputedStyle(el).fontSize]')==baseline)
    page.locator('#embed').evaluate('(el)=>el.style.width="390px"')
    frame.locator('#buyer-name').fill('Test Guest');frame.locator('#buyer-email').fill('test@example.com')
    frame.get_by_role('button',name='Review total').click()
    expect(frame.get_by_role('button',name='Pay $26.63')).to_be_visible()
    check('quote does not open payment',len([c for c in calls if c['action']=='checkout'])==0)
    check('reviewed total comes from API',frame.locator('#totals').inner_text().endswith('$26.63'))
    # Natural foreign-window messages cannot resize or start a checkout.
    height=page.locator('#embed iframe').evaluate('(el)=>el.style.height')
    page.evaluate('window.postMessage({version:1,type:"height",channel:"forged",height:1},"*")')
    page.evaluate('window.postMessage({version:1,type:"checkout",channel:"forged",requestId:1,payload:{}},"*")')
    page.wait_for_timeout(50)
    check('foreign source cannot resize',page.locator('#embed iframe').evaluate('(el)=>el.style.height')==height)
    check('foreign source cannot start commerce',len([c for c in calls if c['action']=='checkout'])==0)
    frame.get_by_role('button',name='Pay $26.63').click()
    expect(page.get_by_role('button',name='Pay test card')).to_be_visible()
    check('Stripe component mounted in merchant document, not selection iframe',page.evaluate('window.__stripeTopLevel') is True)
    check('one checkout attempt created',len(state['attempts'])==1)
    identity=json.loads(page.evaluate(f'sessionStorage.getItem("dvnt-ticket-checkout-v1:{EMBED}")'))
    check('storage contains only recovery proof, no PII/client secret',set(identity)=={'attemptId','token'} and len(identity['token'])==64)
    check('client secret never posted into iframe', 'fixture_payment_secret' not in page.evaluate('JSON.stringify(window.seenMessages)'))
    # Declined/ambiguous cancellation must not reset the customer to a new order.
    state['cancel_failure']=True
    page.get_by_role('button',name='Cancel checkout').click()
    expect(page.get_by_role('alert')).to_contain_text('unknown')
    check('uncertain cancellation retains recovery identity',json.loads(page.evaluate(f'sessionStorage.getItem("dvnt-ticket-checkout-v1:{EMBED}")'))==identity)
    page.reload(wait_until='domcontentloaded')
    expect(page.get_by_role('button',name='Resume checkout / view tickets')).to_be_visible()
    page.get_by_role('button',name='Resume checkout / view tickets').click()
    expect(page.get_by_role('button',name='Pay test card')).to_be_visible()
    check('refresh resumes using same ID/token',calls[-1]['action']=='resume' and calls[-1]['attemptId']==identity['attemptId'] and calls[-1]['token']==identity['token'])
    check('refresh does not create another checkout request',len([c for c in calls if c['action']=='checkout'])==1)
    page.get_by_role('button',name='Pay test card').click()
    expect(page.get_by_role('status')).to_contain_text('Preparing your tickets')
    check('browser callback alone does not display tickets ready',page.get_by_role('link',name='Open ticket 1').count()==0)
    state['fulfilled']=True
    page.get_by_role('button',name='Check ticket status').click()
    expect(page.get_by_role('link',name='Open ticket 1')).to_be_visible()
    check('server fulfillment enables QR ticket access',page.get_by_role('link',name='Open ticket 1').get_attribute('href').startswith(SITE+'/public/tickets/guest/'))
    check('API transport sends no cookies',all('cookie' not in h for h in state['requests']))
    check('no unexpected external traffic',state['unexpected']==[])
    check('no uncaught JavaScript errors',errors==[])
    # Fresh context: confirmed cancellation clears only its recovery record.
    page.evaluate('sessionStorage.clear()');state['cancel_failure']=False;page.reload(wait_until='domcontentloaded')
    frame=page.frame_locator('#embed iframe');expect(frame.locator('#buyer-name')).to_be_visible()
    frame.locator('#buyer-name').fill('Second Guest');frame.locator('#buyer-email').fill('second@example.com')
    frame.get_by_role('button',name='Review total').click();expect(frame.get_by_role('button',name='Pay $26.63')).to_be_visible()
    frame.get_by_role('button',name='Pay $26.63').click();expect(page.get_by_role('button',name='Cancel checkout')).to_be_visible()
    page.get_by_role('button',name='Cancel checkout').click();expect(frame.get_by_role('button',name='Review total')).to_be_visible()
    check('confirmed expiry permits a fresh selection',page.evaluate(f'sessionStorage.getItem("dvnt-ticket-checkout-v1:{EMBED}")') is None)
    page.screenshot(path=str(ROOT/'ticket-embed-browser.png'),full_page=True)
    print(json.dumps({'browser':browser.version,'passed':len(passed),'checks':passed,'stripe':'MOCK ONLY','production_modified':False},indent=2))
    browser.close()
