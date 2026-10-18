/* Task-11 helper: drive the installed Folia Electron app over CDP to capture its real 歌词样式 page.
 * Dev-only tooling. Usage: node scripts/folia-drive.mjs <step> [out.png]
 *   close-changelog -> click the 关闭 button of the release-notes dialog
 *   open-settings   -> click the 设置 gear
 *   open-appearance -> in settings, open 外观 (界面 group) page
 *   open-lyric-style-> click the 歌词动画 row -> VisPlayground 歌词样式 window
 *   shot <file>     -> screenshot the app window
 *   dom             -> dump visible texts/buttons to research/settings-ui/folia-dom.json
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { metricsCollector } from './fidelity-collector.mjs';

const FOLIA_EXE = 'C:/Program Files/Folia/Folia.exe';
const CDP_PORT = 9391;
const PROFILE = 'C:/tmp/folia-ref-profile';
const OUT = resolve(process.cwd(), '..', '..', 'research', 'settings-ui');
const step = process.argv[2] ?? 'dom';

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
}

async function connect() {
    try {
        await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    } catch {
        if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });
        const child = spawn(FOLIA_EXE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`, '--no-sandbox'], { detached: true, stdio: 'ignore' });
        child.unref();
        const start = Date.now();
        for (;;) {
            try { await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch { /* wait */ }
            if (Date.now() - start > 25000) throw new Error('Folia CDP did not come up');
            await new Promise((r) => setTimeout(r, 300));
        }
    }
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}`, defaultViewport: null });
    return browser;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clickByTextOrAria(argTextAndAria) {
    const [text, aria] = JSON.parse(decodeURIComponent(argTextAndAria));
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== 'hidden';
    const cands = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="tab"], a, div[tabindex]')];
    let hit = null;
    if (aria) hit = cands.find((el) => el.getAttribute('aria-label') === aria && isVisible(el));
    if (!hit && text) {
        hit = cands.find((el) => (el.textContent || '').trim() === text && isVisible(el));
        if (!hit) hit = cands.find((el) => (el.textContent || '').trim().includes(text) && isVisible(el) && (el.textContent || '').trim().length <= 40);
    }
    if (!hit) return { ok: false, count: cands.length };
    hit.click();
    return { ok: true, tag: hit.tagName, text: (hit.textContent || '').trim().slice(0, 40) };
}

async function clickText(page, text, aria = null) {
    const arg = encodeURIComponent(JSON.stringify([text, aria]));
    const res = await page.evaluate(`(${clickByTextOrAria.toString()})(${JSON.stringify(arg)})`);
    await sleep(700);
    return res;
}

function collectDom() {
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight);
    const texts = [...document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"]')]
        .filter(isVisible)
        .map((el) => ({ text: (el.textContent || '').trim().slice(0, 80), aria: el.getAttribute('aria-label'), cls: String(el.className || '').slice(0, 60) }))
        .filter((b) => b.text || b.aria);
    const headings = [...document.querySelectorAll('h1, h2, h3, h4, [class*="page-header"], [class*="PageHeader"]')]
        .filter(isVisible)
        .map((el) => (el.textContent || '').trim().slice(0, 80));
    const stWindows = [...document.querySelectorAll('.st-window')].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, x: r.x, y: r.y };
    });
    return { innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio, buttons: texts.slice(0, 200), headings: headings.slice(0, 60), stWindows, bodyText: (document.body.innerText || '').slice(0, 3000) };
}

async function screenshot(page, file) {
    const png = await page.screenshot({ path: file, captureBeyondViewport: false });
    console.log('shot', file, png.length, 'bytes');
}

const browser = await connect();
const pages = await browser.pages();
const page = pages[0];
await page.bringToFront().catch(() => {});
await sleep(1500);

let result = null;
if (step === 'close-changelog') {
    result = await clickText(page, '关闭');
    if (!result?.ok) result = await clickText(page, '关闭', '关闭');
} else if (step === 'open-settings') {
    result = await clickText(page, '', '设置');
} else if (step === 'open-appearance') {
    result = await clickText(page, '外观');
    if (!result?.ok) result = await clickText(page, '界面');
} else if (step === 'open-lyric-style') {
    // The real row is a plain div.st-row (the tab bar also has a 歌词动画 tab, ignore it).
    const rect = await page.evaluate(() => {
        const row = [...document.querySelectorAll('div.st-row')].find((el) => (el.textContent || '').trim().startsWith('歌词动画'));
        if (!row) return null;
        const r = row.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!rect) result = { ok: false, reason: 'row not found' };
    else {
        await page.mouse.click(rect.x, rect.y);
        await sleep(1400);
        result = { ok: true, clicked: rect };
    }
} else if (step === 'shot') {
    const out = resolve(process.argv[3] ?? `${OUT}/folia-real-window.png`);
    await screenshot(page, out);
} else if (step === 'click-next') {
    for (let i = 0; i < 4; i++) {
        const r = (await clickText(page, '下一步')).ok ? { ok: true } : await clickText(page, '就这样');
        result = r;
        if (!r?.ok) break;
        await sleep(900);
    }
} else if (step === 'park-mouse') {
    await page.mouse.move(20, 20);
    await sleep(900);
    result = { ok: true };
} else if (step === 'click-style') {
    const label = process.argv[3] ?? '商籁';
    const res = await page.evaluate((wanted) => {
        const tiles = [...document.querySelectorAll('button[role="radio"], [role="radio"]')];
        const hit = tiles.find((el) => (el.textContent || '').trim() === wanted);
        if (!hit) return { ok: false, count: tiles.length, names: tiles.map((t) => (t.textContent || '').trim()).slice(0, 20) };
        const r = hit.getBoundingClientRect();
        return { ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    if (res.ok) {
        await page.mouse.click(res.x, res.y);
        await sleep(1600);
        result = res;
    } else result = res;
} else if (step === 'click-tab') {
    const label = process.argv[3] ?? '歌词动画';
    const res = await page.evaluate((wanted) => {
        const tabs = [...document.querySelectorAll('button')].filter((el) => (el.textContent || '').trim() === wanted);
        const hit = tabs[tabs.length - 1];
        if (!hit) return { ok: false, count: tabs.length };
        hit.click();
        return { ok: true };
    }, label);
    await sleep(900);
    result = res;
} else if (step === 'shot-el') {
    const out = process.argv[3];
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await sleep(400);
    const rect = await page.evaluate(() => {
        const w = [...document.querySelectorAll('.st-window')].find(el => el.querySelector('h2')?.textContent.trim() === '歌词样式');
        if (!w) return null;
        const r = w.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (!rect) {
        result = { ok: false };
    } else {
        await page.screenshot({ path: out, clip: { ...rect, scale: 1 } });
        result = { ok: true, rect };
    }
} else if (step === 'eval') {
    const script = process.argv[3] || 'null';
    result = await page.evaluate(script);
} else if (step === 'esc') {
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape');
        await sleep(600);
    }
    result = { ok: true };
} else if (step === 'click-tour') {
    for (let i = 0; i < 6; i++) {
        const r = await clickText(page, '思索当前页面');
        if (r?.ok) { result = r; await sleep(1200); continue; }
        const r2 = await clickText(page, '知道了');
        if (r2?.ok) { result = r2; await sleep(900); continue; }
        const r3 = await clickText(page, '完成');
        if (r3?.ok) { result = r3; await sleep(900); continue; }
        break;
    }
} else if (step === 'click-grid') {
    result = await clickText(page, 'Grid');
} else if (step === 'set-viewport') {
    const w = Number(process.argv[3] ?? 1600);
    const h = Number(process.argv[4] ?? 1000);
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await sleep(600);
    result = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
} else if (step === 'metrics') {
    const data = await page.evaluate(metricsCollector);
    const out = process.argv[3] || 'metrics.json';
    writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
    result = { ok: true, out, wins: (data.window || {}).rect };
} else if (step === 'collect') {
    const code = process.argv[3] ?? 'real';
    const data = await page.evaluate(metricsCollector);
    writeFileSync(resolve(OUT, `metrics-${code}.json`), JSON.stringify(data, null, 2), 'utf8');
    result = { ok: true, file: `metrics-${code}.json` };
} else if (step === 'dom') {
    const dom = await page.evaluate(collectDom);
    writeFileSync(resolve(OUT, 'folia-dom.json'), JSON.stringify(dom, null, 2), 'utf8');
    console.log('saved folia-dom.json', JSON.stringify({ innerW: dom.innerW, innerH: dom.innerH, dpr: dom.dpr, buttons: dom.buttons.length, stWindows: dom.stWindows }));
} else if (step === 'shot-el') {
    const out = process.argv[3];
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await sleep(400);
    const rect = await page.evaluate(() => {
        const w = [...document.querySelectorAll('.st-window')].find(el => el.querySelector('h2')?.textContent.trim() === '歌词样式');
        if (!w) return null;
        const r = w.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (!rect) {
        result = { ok: false };
    } else {
        await page.screenshot({ path: out, clip: { ...rect, scale: 1 } });
        result = { ok: true, rect };
    }
} else if (step === 'eval') {
    const code = Buffer.from(process.argv[3] ?? '', 'base64').toString('utf8');
    result = await page.evaluate(code);
    console.log(JSON.stringify(result, null, 2).slice(0, 4000));
} else if (step === 'kill') {
    const pid = process.argv[3] ? Number(process.argv[3]) : null;
    try { pid ? process.kill(pid) : await browser.close(); } catch { /* ignore */ }
    await sleep(1500);
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* locked */ }
}

if (result !== null) console.log(JSON.stringify(result));
await browser.disconnect();
