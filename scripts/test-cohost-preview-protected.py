"""Branch-only verification for disposable DVNT fixtures. Never print secrets."""
import json, os, re, sys, time, urllib.error, urllib.request
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

host = 'dvnt-blog-git-qa-dvnt-cohost-preview-mikefacesnys-projects.vercel.app'
origin = 'https://' + host
stage = 'hsedurpcxcqsgoonatth.supabase.co'
fixture_host = json.loads(os.environ['HOST_FIXTURE'])
fixture_recipient = json.loads(os.environ['RECIPIENT_FIXTURE'])
key = os.environ['VERCEL_PREVIEW_KEY']
event = os.environ['FIXTURE_EVENT']
action = os.environ['OPERATION']
assert re.fullmatch(r'[1-9][0-9]{0,8}', event) and action in ('issue', 'claim')
assert re.fullmatch(r'delivered\+dvntcohosthost[a-f0-9]{10}@resend\.dev', fixture_host['email'])
assert re.fullmatch(r'delivered\+dvntcohostrecipient[a-f0-9]{10}@resend\.dev', fixture_recipient['email'])
assert fixture_host['id'] != fixture_recipient['id'] and len(key) > 25
stage_step = 'preview readiness'
try:
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, url):
            return None
    fetch = urllib.request.build_opener(NoRedirect())
    deadline = time.monotonic() + 600
    while True:
        req = urllib.request.Request(origin + '/auth/login', headers={'x-vercel-protection-bypass': key})
        try:
            with fetch.open(req, timeout=12) as result:
                if result.status == 200:
                    break
        except urllib.error.HTTPError as err:
            assert err.code in (401, 403, 404, 409, 502, 503, 504)
        assert time.monotonic() < deadline, 'private preview not ready or its access key was refused'
        time.sleep(12)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        stage_step = 'real preview sign-in'
        account = fixture_host if action == 'issue' else fixture_recipient
        def route_request(route):
            u=urlsplit(route.request.url)
            if u.scheme=='https' and u.hostname==host:
                route.continue_(headers={**route.request.headers, 'x-vercel-protection-bypass':key})
            elif u.scheme=='https' and u.hostname==stage:
                route.continue_()
            else:
                route.abort()
        ctx.route('**/*', route_request)
        page=ctx.new_page()
        login=page.goto(origin+'/auth/login',wait_until='domcontentloaded',timeout=45000)
        assert login and login.ok
        page.get_by_placeholder('you@example.com').fill(account['email'],timeout=20000)
        page.get_by_placeholder('Enter your password').fill(account['password'])
        with page.expect_response(lambda r: r.request.method=='POST' and urlsplit(r.url).path=='/api/auth/sign-in/email', timeout=20000) as sign:
            page.get_by_text('Sign in',exact=True).last.click()
        assert sign.value.ok and sign.value.json()['user']['id']==account['id']
        page.wait_for_url(lambda u: urlsplit(u).hostname==host and urlsplit(u).path!='/auth/login',timeout=30000)
        if action=='issue':
            stage_step = 'protected staff page entry'
            response=page.goto(origin + '/feed/events/' + event + '/staff', wait_until='domcontentloaded', timeout=75000)
            assert response and response.ok
            link=page.get_by_role('link', name='Invite event staff by email', exact=True)
            try:
                link.wait_for(timeout=45000)
            except Exception:
                safe=page.locator('body').inner_text(timeout=3000).lower()
                print('staff diagnostics:', 'add-staff='+str('add staff member' in safe), 'staff-owner-only='+str('only the event owner' in safe), 'onboard='+str('first post' in safe or 'profile photo' in safe), 'login='+str('/auth/login' in page.url))
                raise
            link.click(timeout=15000)
            stage_step = 'hosted invitation form'
            page.get_by_role('heading', name='Invite event staff by email', exact=True).wait_for(timeout=20000)
            page.get_by_label('Email').fill(fixture_recipient['email'])
            page.get_by_label('Role').select_option('editor')
            with page.expect_response(lambda r: r.request.method=='POST' and urlsplit(r.url).path=='/staff-email/invite/'+event, timeout=20000) as result:
                page.get_by_role('button',name='Queue email invitation',exact=True).click()
            assert result.value.status == 202
            page.get_by_text('Invitation queued. Delivery is not confirmed.', exact=True).wait_for(timeout=8000)
            print('PASS protected hosted staff page reached exact invite form and queued one synthetic invite')
        else:
            fragment = os.environ['INVITE_FRAGMENT']
            assert re.fullmatch(r'[a-f0-9]{64}',fragment)
            stage_step = 'claim fragment and deliberate acceptance'
            response=page.goto(origin+'/public/staff/claim#'+fragment,wait_until='domcontentloaded',timeout=45000)
            assert response and response.ok
            ok=page.get_by_role('button',name='Accept with this account',exact=True)
            ok.wait_for(timeout=20000)
            assert page.evaluate('location.hash')==''
            with page.expect_response(lambda r: r.request.method=='POST' and urlsplit(r.url).path=='/public/staff/claim', timeout=20000) as result:
                ok.click()
            assert result.value.status==200
            page.get_by_text('Staff invitation accepted.',exact=True).wait_for(timeout=8000)
            print('PASS hosted preview scrubbed fragment and granted synthetic invited account deliberate acceptance')
        browser.close()
except Exception as exc:
    print('FAIL phase:',stage_step,'failure type:',type(exc).__name__)
    sys.exit(1)
