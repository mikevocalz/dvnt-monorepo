#!/usr/bin/env python3
"""Real Stripe sandbox acceptance. No mocks. Refuses production hosts/keys.
Configure a disposable staging event, connected test organizer and external test host.
Never writes raw API responses, card/client secrets, email or QR URLs to artifacts.
Stripe test card reference: https://docs.stripe.com/testing#cards
"""
import json, os, re, time, urllib.parse, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
required=['TICKET_EMBED_SANDBOX_HOST_URL','TICKET_EMBED_SANDBOX_ID','TICKET_EMBED_SANDBOX_EMAIL','STRIPE_TEST_SECRET_KEY']
missing=[key for key in required if not os.environ.get(key)]
if missing:
    raise SystemExit('RELEASE BLOCKED: real sandbox purchase is not configured. Missing: '+', '.join(missing))
host_url=os.environ[required[0]]; embed_id=os.environ[required[1]]; email=os.environ[required[2]]; key=os.environ[required[3]]
production={'dvntapp.live','www.dvntapp.live','dvnt.live','www.dvnt.live'}
assert re.fullmatch(r'(sk|rk)_test_[A-Za-z0-9]+',key),'Only a Stripe TEST key is permitted'
assert re.fullmatch(r'[a-fA-F0-9-]{36}',embed_id),'A disposable embed ID is required'
assert urllib.parse.urlparse(host_url).scheme=='https' and urllib.parse.urlparse(host_url).hostname not in production,'Never run acceptance on production'
def stripe(method,path,params=None):
    body=urllib.parse.urlencode(params).encode() if params is not None else None
    req=urllib.request.Request('https://api.stripe.com/v1'+path,data=body,method=method,
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded','Stripe-Version':'2025-02-24.acacia'})
    with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
result={'commit':os.environ.get('GITHUB_SHA','local'),'real_stripe_sandbox':True,'passed':False}
with sync_playwright() as p:
    # A protected Vercel preview admits the automation token through this header. Only the preview hosts get it:
    # a context-wide header would hand the secret to Stripe and the external host and trip their CORS preflights.
    bypass=os.environ.get('TICKET_EMBED_SANDBOX_BYPASS')
    preview_hosts={urllib.parse.urlparse(host_url).hostname}
    def bypass_headers(url):
        return {'x-vercel-protection-bypass':bypass} if bypass and urllib.parse.urlparse(url).hostname in preview_hosts else {}
    browser=p.chromium.launch(headless=True); context=browser.new_context(); page=context.new_page()
    context.route('**/*',lambda route:route.continue_(headers={**route.request.headers,**bypass_headers(route.request.url)}))
    page.set_default_timeout(60000)
    observed={'checkout':None,'fulfilled':None}
    def observe(response):
        if urllib.parse.urlparse(response.url).path!='/embed/api' or response.request.method!='POST':return
        try:
            data=response.json()
            if data.get('clientSecret'):observed['checkout']=data
            if data.get('state')=='fulfilled':observed['fulfilled']=data
        except Exception:pass
    page.on('response',observe)
    try:
        page.goto(host_url,wait_until='domcontentloaded')
        widget=page.locator(f'[data-dvnt-ticket-embed="{embed_id}"]')
        frame=widget.frame_locator('iframe')
        expect(frame.locator('#dvnt-data')).to_be_attached()
        descriptor=json.loads(frame.locator('#dvnt-data').text_content())
        assert descriptor.get('testMode') is True,'Refusing to reserve live inventory: descriptor must confirm test mode'
        assert urllib.parse.urlparse(descriptor['siteOrigin']).hostname not in production,'Staging must use a non-production ticket platform'
        preview_hosts.add(urllib.parse.urlparse(descriptor['siteOrigin']).hostname)
        frame.locator('#buyer-name').fill('DVNT Sandbox Test')
        frame.locator('#buyer-email').fill(email)
        for field in frame.locator('#attendees input').all():field.fill('Sandbox Attendee')
        frame.get_by_role('button',name='Review total').click()
        pay=frame.get_by_role('button',name=re.compile(r'^Pay \$'))
        expect(pay).to_be_visible(timeout=30000);pay.click()
        deadline=time.monotonic()+60
        while not observed['checkout'] and time.monotonic()<deadline:page.wait_for_timeout(250)
        assert observed['checkout'] and observed['checkout']['publishableKey'].startswith('pk_test_'),'Refusing to send test-card data to live Stripe'
        assert observed['checkout']['totals']['total']<=5000,'Use a test ticket costing at most $50'
        def field(selectors,value):
            deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                for f in page.frames:
                    if not (urllib.parse.urlparse(f.url).hostname or '').endswith('.stripe.com'):continue
                    target=f.locator(selectors)
                    if target.count() and target.first.is_visible():target.first.fill(value);return
                page.wait_for_timeout(250)
            raise AssertionError('Stripe test payment field did not become available')
        field('input[name="cardNumber"],input[autocomplete="cc-number"]','4242424242424242')
        field('input[name="cardExpiry"],input[autocomplete="cc-exp"]','1239')
        field('input[name="cardCvc"],input[autocomplete="cc-csc"]','123')
        submitted=False
        for f in page.frames:
            if not (urllib.parse.urlparse(f.url).hostname or '').endswith('.stripe.com'):continue
            postal=f.locator('input[name="billingPostalCode"],input[autocomplete="postal-code"]')
            if postal.count() and postal.first.is_visible():postal.first.fill('10001')
            button=f.get_by_role('button',name=re.compile(r'^Pay(?:\s|$)'))
            if button.count()==1 and button.is_visible():button.click();submitted=True;break
        assert submitted,'Stripe submit button not found; do not bypass checkout by confirming an unrelated PaymentIntent'
        expect(widget.get_by_role('link',name='Open ticket 1')).to_be_visible(timeout=120000)
        assert observed['fulfilled'],'No server-confirmed fulfillment response'
        secret=observed['checkout']['clientSecret']
        session_id=secret.split('_secret_')[0]
        assert re.fullmatch(r'cs_test_[A-Za-z0-9]+',session_id),'Not a test Checkout Session'
        session=stripe('GET','/checkout/sessions/'+session_id)
        assert session['livemode'] is False and session['payment_status']=='paid'
        assert session['client_reference_id']==observed['fulfilled']['orderId']
        assert len(observed['fulfilled']['tickets'])==1 and observed['fulfilled']['emailStatus']=='sent','Verify QR issuance and staging email delivery before release'
        for ticket in observed['fulfilled']['tickets']:
            assert urllib.parse.urlparse(ticket['url']).hostname not in production
            assert page.request.get(ticket['url'],headers=bypass_headers(ticket['url'])).ok,'Issued test ticket cannot be opened'
        refund=stripe('POST','/refunds',{'payment_intent':session['payment_intent']})
        assert refund['status']=='succeeded','Sandbox refund did not succeed'
        result.update(passed=True,payment=True,one_order=True,qr_ticket=True,email_delivery=True,refund=True)
    finally:
        browser.close()
        Path('ticket-embed-sandbox-result.json').write_text(json.dumps(result,indent=2))
print('PASS: real sandbox payment, server-confirmed order, QR access, email delivery and refund. No live transaction.')
