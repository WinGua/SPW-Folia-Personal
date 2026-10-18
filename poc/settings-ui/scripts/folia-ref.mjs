/* Task-11 helper: attach to the installed Folia Electron app over CDP and screenshot its real UI.
 * Dev-only tooling, not part of the shipped bundle. Usage:
 *   node scripts/folia-ref.mjs probe                  -> connect, dump pages/buttons
 *   node scripts/folia-ref.mjs shot <outfile> [wait]  -> screenshot the main window
 *   node scripts/folia-ref.mjs open-lyric-styles      -> try to open the 歌词样式 page
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const FOLIA_EXE = 'C:/Program Files/Folia/Folia.exe';
const CDP_PORT = 9391;
const PROFILE = 'C:/tmp/folia-ref-profile';
const OUT = resolve(process.cwd(), '..', '..', 'research/settings-ui');
const mode = process.argv[2] ?? 'probe';

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
}

async function waitForCdp(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
            return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('Folia CDP endpoint did not come up');
}

async function connect() {
    // Reuse an already-running Folia instance if its CDP endpoint answers.
    try {
        await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}`, defaultViewport: null });
        return { browser, pid: null };
    } catch { /* not running */ }
    if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });
    const child = spawn(FOLIA_EXE, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE}`,
        '--no-sandbox',
        '--disable-gpu-sandbox',
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    await waitForCdp();
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}`, defaultViewport: null });
    return { browser, pid: child.pid };
}

function summarizeDom() {
    const texts = [];
    const walk = (el, depth) => {
        if (depth > 40 || !el) return;
        for (const n of el.children) walk(n, depth + 1);
        if (el.children.length === 0) {
            const t = (el.textContent || '').trim();
            if (t) texts.push(t);
        }
    };
    walk(document.body, 0);
    const uniq = [...new Set(texts)];
    return {
        title: document.title,
        url: location.href,
        bodyLen: document.body?.innerHTML.length ?? 0,
        texts: uniq.slice(0, 400),
        buttons: [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')].slice(0, 200).map((b) => ({
            aria: b.getAttribute('aria-label'),
            title: b.getAttribute('title'),
            text: (b.textContent || '').trim().slice(0, 60),
            cls: (b.className && String(b.className).slice(0, 80)) || '',
        })),
    };
}

const { browser, pid } = await connect();
const pages = await browser.pages();
console.log(JSON.stringify({ pid, pages: pages.map((p) => p.url()) }, null, 2));
const page = pages[0];
await page.bringToFront().catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

if (mode === 'probe') {
    const info = await page.evaluate(summarizeDom);
    writeFileSync(resolve(OUT, 'folia-real-probe.json'), JSON.stringify(info, null, 2), 'utf8');
    console.log('saved', resolve(OUT, 'folia-real-probe.json'), 'texts', info.texts.length);
} else if (mode === 'shot') {
    const out = resolve(process.argv[3] ?? `${OUT}/folia-real.png`);
    await page.setViewport(null).catch(() => {});
    await page.screenshot({ path: out, captureBeyondViewport: false }).catch(async (e) => {
        console.log('page.screenshot failed:', e.message);
        const session = await page.createCDPSession();
        const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(out, Buffer.from(data, 'base64'));
    });
    console.log('saved', out);
} else if (mode === 'open-lyric-styles') {
    console.log('not implemented yet');
}

await browser.disconnect();
if (process.argv.includes('--kill')) {
    try { process.kill(pid); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 1500));
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* locked */ }
}
