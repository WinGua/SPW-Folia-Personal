// Scratch diagnostic: does the preview child shim run inside a same-origin iframe?
//
//   python -m http.server 18095 --directory packaging/web
//   node scripts/diag-preview.mjs
//
// Loads the OBS page as the top document, injects `<iframe src="/preview.html?obs=1&preview=1">`,
// waits for the child `ready`, posts a config built from poc/webview/shared/demoData.mjs and reports
// the child renderer state. Read-only: nothing here ships in the settings-ui bundle.
import puppeteer from 'puppeteer-core';
import { CONFIG } from '../../webview/shared/demoData.mjs';

const origin = 'http://127.0.0.1:18095';
const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const logs = [];
page.on('console', (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(`${origin}/index.html?obs=1&preview=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.id = 'diag-wrap';
    wrapper.style.cssText = 'position:fixed;inset:0;overflow:hidden;z-index:999999;background:#000';
    const frame = document.createElement('iframe');
    frame.id = 'diag-frame';
    frame.src = '/preview.html?obs=1&preview=1';
    frame.style.cssText = 'position:absolute;left:50%;top:50%;width:1920px;height:1080px;border:0;transform:translate(-50%,-50%) scale(0.5)';
    wrapper.appendChild(frame);
    document.body.appendChild(wrapper);
    window.__diagMessages = [];
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.__spwFoliaPreview === 1) window.__diagMessages.push(String(data.kind));
    });
});

const childState = () => page.evaluate(() => {
    const frame = document.getElementById('diag-frame');
    const win = frame && frame.contentWindow;
    const doc = frame && frame.contentDocument;
    return {
        shim: !!(win && win.__SPW_FOLIA_PREVIEW_SHIM__),
        api: win && win.__SPW_FOLIA_PREVIEW__ ? { ...win.__SPW_FOLIA_PREVIEW__ } : null,
        canvases: doc ? doc.querySelectorAll('canvas').length : -1,
        scripts: doc ? Array.from(doc.scripts).map((s) => (s.src || '(inline)').replace('http://127.0.0.1:18095', '')).slice(0, 4) : [],
        bodyText: doc ? (doc.body.innerText || '').slice(0, 80) : '',
        messages: window.__diagMessages,
    };
});

await new Promise((r) => setTimeout(r, 2000));
const before = await childState();

await page.evaluate((config) => {
    const frame = document.getElementById('diag-frame');
    const post = (kind, payload) => frame.contentWindow.postMessage({ __spwFoliaPreview: 1, kind, payload }, location.origin);
    post('config', config);
    post('meta', { loopDuration: 14.4, startOffset: 0 });
    post('paused', false);
}, JSON.parse(JSON.stringify(CONFIG)));

await new Promise((r) => setTimeout(r, 4000));
const after = await childState();
console.log(JSON.stringify({ before, after, logs: logs.slice(0, 25) }, null, 2));
await browser.close();
