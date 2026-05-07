"""
Playwright end-user smoke test: ΘΕΜΙΣ OS login → dashboard.
Verifies real browser flow (not curl), captures network, cookies, screenshot.
"""
import asyncio
from playwright.async_api import async_playwright

URL = 'https://themis.mentorist.gr/login'
EMAIL = 'demo@themisos.gr'
PASSWORD = 'Demo2026!Themis'

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        responses = []
        console_msgs = []

        async def on_response(r):
            try:
                responses.append({
                    'status': r.status,
                    'url': r.url,
                    'set_cookie': r.headers.get('set-cookie'),
                    'location': r.headers.get('location'),
                })
            except Exception:
                pass

        page.on('response', lambda r: asyncio.create_task(on_response(r)))
        page.on('console', lambda m: console_msgs.append(f"[{m.type}] {m.text}"))
        page.on('pageerror', lambda e: console_msgs.append(f"[pageerror] {e}"))

        print(f'--- Navigating to {URL}')
        await page.goto(URL, wait_until='networkidle')
        print(f'--- URL after load: {page.url}')

        await page.fill('#email', EMAIL)
        await page.fill('#password', PASSWORD)
        print('--- Submitting form')

        await page.click('button[type="submit"]')
        try:
            await page.wait_for_url(lambda u: '/login' not in u, timeout=10000)
        except Exception as e:
            print(f'--- wait_for_url timeout: {e}')

        await page.wait_for_timeout(2500)
        print(f'--- URL after submit: {page.url}')

        cookies = await context.cookies()
        print(f'--- Cookies count: {len(cookies)}')
        for c in cookies:
            print(f'    {c.get("name")}={str(c.get("value"))[:20]}... domain={c.get("domain")} sameSite={c.get("sameSite")} secure={c.get("secure")} httpOnly={c.get("httpOnly")} path={c.get("path")}')

        try:
            errs = await page.locator('[role="alert"]').all_text_contents()
            print(f'--- Visible alerts: {errs}')
        except Exception:
            pass

        body_text = await page.locator('body').inner_text()
        print(f'--- Body preview (first 400 chars):')
        print(body_text[:400])

        print('--- Network log:')
        for r in responses:
            if ('/auth/' in r['url'] or '/login' in r['url'] or '/dashboard' in r['url']
                    or r['set_cookie'] or r['status'] >= 300):
                extra = ''
                if r['set_cookie']:
                    extra += f" SET-COOKIE: {r['set_cookie'][:160]}"
                if r['location']:
                    extra += f" LOC: {r['location']}"
                print(f"  {r['status']} {r['url']}{extra}")

        print('--- Console:')
        for m in console_msgs:
            print(f'  {m}')

        await page.screenshot(path='/root/projects/themis-os/scripts/login-after.png', full_page=True)
        print('--- Screenshot: /root/projects/themis-os/scripts/login-after.png')

        # Final assertion
        success = '/dashboard' in page.url
        print(f'--- RESULT: {"PASS" if success else "FAIL"} (final URL: {page.url})')
        await browser.close()
        return 0 if success else 1

import sys
sys.exit(asyncio.run(main()))
