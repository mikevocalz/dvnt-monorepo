"""Browser isolation/layout/navigation tests. Checkout destination is intercepted, not paid."""
import http.server
import pathlib
import threading
from playwright.sync_api import sync_playwright

root = pathlib.Path('.widget-browser')
html = (root / 'widget.html').read_bytes()
class Host(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        if self.server.server_port == 8124:
            self.send_header('Content-Security-Policy', "default-src 'none'; img-src https:; style-src 'unsafe-inline'; frame-ancestors http://127.0.0.1:8123; base-uri 'none'; form-action 'none'")
            body = html
        else:
            body = b'''<!doctype html><style>body{margin:0}.sentinel{font-size:21px}</style><div class="sentinel">Host unaffected</div><iframe src="http://127.0.0.1:8124/" sandbox="allow-popups allow-popups-to-escape-sandbox" style="width:100%;height:980px;border:0"></iframe>'''
        self.end_headers()
        self.wfile.write(body)
servers = []
for port in (8123, 8124, 8125):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Host)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    servers.append(server)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        requests = []
        context.on('request', lambda req: requests.append(req.url))
        def intercept(route):
            url = route.request.url
            if url.endswith('.svg'):
                route.fulfill(content_type='image/svg+xml', body=pathlib.Path('apps/web/public/dvnt-wordmark.svg').read_text())
            elif url.endswith('/flyer.jpg'):
                route.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="300" height="350"><rect width="300" height="350" fill="purple"/></svg>')
            elif url == 'https://dvntapp.live/feed/events/1':
                route.fulfill(content_type='text/html', body='<title>Checkout navigation fixture</title>Existing checkout destination')
            else:
                raise AssertionError('Unexpected external request: ' + url)
        context.route('https://**/*', intercept)
        page = context.new_page()
        for width in (320, 390, 740, 1100):
            page.set_viewport_size({'width': width, 'height': 1100})
            page.goto('http://127.0.0.1:8123/')
            frame = page.frame_locator('iframe')
            frame.locator('h1').wait_for()
            columns = frame.locator('.body').evaluate("el => getComputedStyle(el).gridTemplateColumns.split(' ').length")
            assert columns == (2 if width >= 740 else 1), (width, columns)
            assert frame.locator('body').evaluate('el => el.scrollWidth <= innerWidth')
            assert frame.locator('header img').count() == 1 and frame.locator('footer img').count() == 1
            assert frame.locator('.flyer').count() == 1
            assert page.locator('.sentinel').evaluate('el => getComputedStyle(el).fontSize') == '21px'
            assert frame.locator('form,script').count() == 0
            if width in (390, 1100):
                page.screenshot(path=str(root / f'widget-{width}.png'), full_page=True)
            with context.expect_page() as opened:
                frame.locator('a.buy').click()
            popup = opened.value
            popup.wait_for_load_state()
            assert popup.url == 'https://dvntapp.live/feed/events/1'
            assert popup.evaluate('window.opener === null')
            assert page.url == 'http://127.0.0.1:8123/'
            popup.close()
            print('PASS layout, brand, flyer, host isolation and checkout navigation:', width)
        denied = context.new_page()
        errors = []
        denied.on('console', lambda msg: errors.append(msg.text))
        denied.goto('http://127.0.0.1:8125/')
        denied.wait_for_timeout(750)
        assert any('frame-ancestors' in error for error in errors), errors
        assert not any('/functions/' in url or 'stripe.com' in url for url in requests)
        print('PASS wrong-origin framing rejected; no Stripe or purchase API requests')
        browser.close()
finally:
    for server in servers:
        server.shutdown()
