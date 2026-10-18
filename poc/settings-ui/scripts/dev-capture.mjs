/* Task-11: run our settings UI in plain Edge (dev.html), capture 4 tab screenshots at 1600x1000 CSS
 * and collect the same fidelity metrics as the real Folia app.
 * Usage: node scripts/dev-capture.mjs   (self-contained: starts its own vite dev server on :18099) */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { metricsCollector } from './fidelity-collector.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 18099;
const OUT = resolve(process.cwd(), '..', '..', 'research', 'settings-ui');
const TABS = ['歌词动画', '背景', '字体', '字幕'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: 'ignore', detached: false,
});
process.on('exit', () => { try { vite.kill(); } catch { /* ignore */ } });

const start = Date.now();
for (;;) {
    try {
        const res = await fetch(`http://localhost:${PORT}/dev.html`);
        if (res.ok) break;
    } catch { /* not up */ }
    if (Date.now() - start > 30000) throw new Error('vite dev server did not start');
    await sleep(300);
}

const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/dev.html`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('.st-window', { timeout: 30000 });
await sleep(1200);

await page.evaluate(metricsCollector).then((data) => writeFileSync(resolve(OUT, 'metrics-ours.json'), JSON.stringify(data, null, 2), 'utf8'));

for (const label of TABS) {
    try {
        await page.evaluate((want) => {
            const btns = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === want);
            const hit = btns[btns.length - 1];
            if (hit) hit.click();
        }, label);
    } catch (e) {
        console.log('tab click failed', label, e.message);
    }
    await sleep(800);
    await page.mouse.move(20, 20);
    await sleep(300);
    const file = resolve(OUT, `ours-tab-${label}.png`);
    await page.screenshot({ path: file });
    console.log('shot', file);
    const win = await page.$('.st-window');
    if (win) {
        const winPath = resolve(OUT, label === '歌词动画' ? 'ours-window.png' : `ours-window-${label}.png`);
        await win.screenshot({ path: winPath });
        console.log('shot', winPath);
    }
    if (label === '歌词动画') {
        await page.evaluate(metricsCollector).then((data) => writeFileSync(resolve(OUT, 'metrics-ours.json'), JSON.stringify(data, null, 2), 'utf8'));
    }
}

const errors = await page.evaluate(() => window.__SPW_DEV_ERRORS__ || []);
console.log('page errors', JSON.stringify(errors).slice(0, 400));
await browser.close();
try { vite.kill(); } catch { /* ignore */ }
console.log('done');
