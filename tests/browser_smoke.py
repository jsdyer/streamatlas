"""CI-only Chromium checks at a project subpath; no real audio is played."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
import shutil
import tempfile
import threading
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
AXE = ROOT / 'node_modules' / 'axe-core' / 'axe.min.js'
ROW = {'stationuuid':'01234567-89ab-cdef-0123-456789abcdef','name':'<img src=x onerror="alert(1)"> Wellington','url_resolved':'https://stream.example.org/live','homepage':'https://example.org/','countrycode':'NZ','state':'Wellington','language':'english','tags':'experimental,jazz','codec':'MP3','bitrate':128,'lastcheckok':1,'lastchecktime_iso8601':'2026-11-23T00:00:00Z'}

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def check_accessibility(page, state):
    page.add_script_tag(path=str(AXE))
    result = page.evaluate("""async () => await axe.run(document, {
      runOnly: {type: 'rule', values: ['color-contrast', 'label-content-name-mismatch', 'aria-prohibited-attr']}
    })""")
    failures = [{'rule': rule['id'], 'targets': [node['target'] for node in rule['nodes']]} for rule in result['violations']]
    assert not failures, {'state': state, 'failures': failures}
    assert not [rule for rule in result['incomplete'] if rule['id'] == 'aria-prohibited-attr'], {'state': state, 'incomplete': 'ARIA group naming'}

def main():
    screenshots = ROOT / 'browser-checks'
    screenshots.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        shutil.copytree(ROOT / 'dist', Path(temporary) / 'streamatlas')
        server = ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=temporary))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch()
                context = browser.new_context(viewport={'width':1280,'height':1000}, service_workers='block')
                page = context.new_page()
                errors, requests, observed_requests, observed_responses = [], [], [], []
                page.on('request', lambda request: observed_requests.append({'url':request.url,'method':request.method}) if request.url.startswith('https://') else None)
                page.on('response', lambda response: observed_responses.append({'url':response.url,'status':response.status}) if response.url.startswith('https://') else None)
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.add_init_script('''
                  window.mediaStarts = 0;
                  HTMLMediaElement.prototype.play = function() { window.mediaStarts++; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
                  HTMLMediaElement.prototype.pause = function() {};
                  HTMLMediaElement.prototype.load = function() {};
                ''')
                def network(route):
                    url = route.request.url
                    requests.append(url)
                    if '/json/servers' in url:
                        route.fulfill(json=[{'name':'de1.api.radio-browser.info'}], headers={'Access-Control-Allow-Origin':'*'})
                    elif '/json/stations/search' in url:
                        params=parse_qs(urlsplit(url).query)
                        assert params['countrycode']==['NZ']
                        assert params['name']==['Anything & more']
                        route.fulfill(json=[ROW], headers={'Access-Control-Allow-Origin':'*'})
                    elif '/json/url/' in url:
                        route.fulfill(json={'ok':True,'stationuuid':ROW['stationuuid'],'url':ROW['url_resolved']}, headers={'Access-Control-Allow-Origin':'*'})
                    else:
                        route.abort()
                # Route the whole context with an explicit URL regex; every external request
                # must be handled here, never allowed to reach a real provider in CI.
                context.route(re.compile(r'^https://'), network)
                page.goto(f'http://127.0.0.1:{server.server_port}/streamatlas/')
                page.locator('.station').first.wait_for()
                assert page.locator('.station').count() > 10
                assert page.evaluate('window.mediaStarts') == 0
                assert not requests, requests
                assert page.evaluate('localStorage.length') == 0
                assert page.locator('.save').first.get_attribute('aria-label').startswith('Add to my stations: ')
                check_accessibility(page, 'desktop unsaved shelf')
                page.locator('.save').first.click()
                assert page.locator('#saved-count').inner_text()=='1'
                assert page.locator('.save').first.get_attribute('aria-label').startswith('In my stations: ')
                check_accessibility(page, 'desktop saved toggle')
                assert page.evaluate('localStorage.length')==0
                page.locator('#show-saved').click()
                assert page.locator('.station').count()==1
                page.locator('#remember').check()
                assert page.evaluate("localStorage.getItem('coolcode:streamatlas:favourites:v1')")
                page.locator('#remember').uncheck()
                assert page.evaluate('localStorage.length')==0
                page.locator('#name').fill('Anything & more')
                page.locator('#countrycode').fill('NZ')
                page.locator('#search-button').click()
                page.wait_for_function("!document.querySelector('#search-button').disabled")
                diagnostics = {'status': page.locator('#status').inner_text(), 'heading': page.locator('#results-heading').inner_text(), 'count': page.locator('#result-count').inner_text(), 'requests': requests, 'observed_requests': observed_requests, 'observed_responses': observed_responses, 'errors': errors}
                print('Mocked search diagnostics:', json.dumps(diagnostics), flush=True)
                page.screenshot(path=str(screenshots/'mocked-search.png'), full_page=True)
                assert len([url for url in requests if '/json/servers' in url]) == 1, diagnostics
                assert len([url for url in requests if '/json/stations/search' in url]) == 1, diagnostics
                assert page.locator('#results-heading').inner_text() == 'Beyond the familiar', diagnostics
                assert page.locator('.station').count() == 1, diagnostics
                assert 'Wellington' in page.locator('.station h3').inner_text()
                assert page.locator('.station img').count()==0
                assert page.evaluate('window.mediaStarts')==0
                with page.expect_response(re.compile(r'/json/url/')):
                    page.locator('.play').click()
                assert page.evaluate('window.mediaStarts')==1
                assert page.locator('#player-label').inner_text()=='NOW LISTENING'
                page.wait_for_function("document.querySelector('#audio').hasAttribute('src')")
                page.locator('#stop').click()
                assert not page.locator('#audio').get_attribute('src')
                assert any('/json/url/' in url for url in requests)
                page.locator('#local-filter').fill('no such thing')
                assert page.locator('#empty').is_visible()
                page.locator('#local-filter').fill('')
                page.locator('#show-shelf').click()
                page.screenshot(path=str(screenshots/'desktop.png'), full_page=True)
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                check_accessibility(page, 'mobile shelf')
                page.screenshot(path=str(screenshots/'mobile.png'), full_page=True)
                assert not errors, errors
                browser.close()
            print('Browser checks passed: live arbitrary search, retained data, no autoplay, mocked playback, opt-in storage, safe text and 390px layout')
        finally:
            server.shutdown()

if __name__=='__main__':
    main()
