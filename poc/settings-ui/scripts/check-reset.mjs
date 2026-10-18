// Verifies the window's reset button: change a style tuning, press 默认, read the store back through
// the published config (dev harness). Run with the dev server up: node scripts/check-reset.mjs
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
await page.goto('http://localhost:18090/dev.html', { waitUntil: 'networkidle0' });
await page.waitForSelector('[role="tab"]');

const readConfig = () => page.evaluate(() => window.__SPW_FOLIA_LAST_CONFIG__ ?? null);
const readTuning = () => page.evaluate(() => {
    const root = document.querySelector('.st-window');
    const store = window.__SPW_SETTINGS_STORE__;
    if (store) return store.getState().styleTunings.sonnet.textureResolution;
    return root ? 'no-store' : 'no-window';
});
void readTuning;

const before = (await readConfig())?.visualizerTunings?.sonnet?.textureResolution;
// Move the first aside slider (渲染质量 → 纹理分辨率) to its maximum.
await page.evaluate(() => {
    const input = document.querySelector('aside input[type="range"]');
    if (!input) return;
    input.value = String(Number(input.max));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));
const changed = (await readConfig())?.visualizerTunings?.sonnet?.textureResolution;

// 默认 button lives in the tabs row of the right column.
const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const reset = buttons.find(b => (b.textContent || '').trim() === '默认');
    if (!reset) return false;
    reset.click();
    return true;
});
await new Promise(r => setTimeout(r, 400));
const after = (await readConfig())?.visualizerTunings?.sonnet?.textureResolution;

console.log(JSON.stringify({ before, changed, after, clicked, resetWorks: changed !== before && after === before }));
await browser.close();
