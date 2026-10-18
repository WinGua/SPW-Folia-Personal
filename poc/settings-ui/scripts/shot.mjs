// Captures the settings window for review: fullscreen chrome (⚙), then the four tabs.
// Dev server: pnpm dev (http://localhost:18090/dev.html). Usage: node scripts/shot.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = resolve('../../research/settings-ui');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.goto('http://localhost:18090/dev.html', { waitUntil: 'networkidle0' });
await page.waitForSelector('[role="tab"]');

const shot = async (name) => {
    await page.screenshot({ path: resolve(OUT, name) });
    console.log('shot', name);
};

// Start from the overlay open (dev default); close it through the header back button so the gear can
// be captured the way the user first sees the injected page.
await page.evaluate(() => document.querySelector('[data-spw-settings-ui] [aria-label="返回"]')?.click());
await new Promise(r => setTimeout(r, 600));
await page.mouse.move(1200, 120);
await new Promise(r => setTimeout(r, 200));
await shot('chrome-fullscreen.png');

// The gear summons the overlay.
await page.click('[data-spw-chrome="settings"]');
await page.waitForSelector('.st-window');
await new Promise(r => setTimeout(r, 500));
await shot('window-tab-visualizer.png');

const tabs = [
    ['背景', 'window-tab-background.png'],
    ['字体', 'window-tab-font.png'],
    ['字幕', 'window-tab-subtitle.png'],
    ['歌词动画', 'window-tab-visualizer.png'],
];
for (const [label, file] of tabs) {
    const clicked = await page.evaluate(text => {
        const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(node => (node.textContent || '').trim() === text);
        if (!tab) return false;
        tab.click();
        return true;
    }, label);
    if (!clicked) throw new Error(`tab not found: ${label}`);
    await new Promise(r => setTimeout(r, 350));
    await shot(file);
}

// Switch style to 凝彩 through the shelf, keep the frame + panel in sync.
await page.evaluate(() => {
    const tile = Array.from(document.querySelectorAll('[role="radio"]')).find(node => (node.textContent || '').includes('凝彩'));
    tile?.click();
});
await new Promise(r => setTimeout(r, 500));
await shot('window-style-tempera.png');

// Tuning change round-trips through the publisher.
await page.evaluate(() => {
    const input = document.querySelector('aside input[type="range"]');
    if (!input) return;
    input.value = String(Number(input.max));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 500));
const config = await page.evaluate(() => window.__SPW_FOLIA_LAST_CONFIG__ ?? null);
if (config) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(OUT, 'pushed-config.json'), JSON.stringify(config, null, 2));
}
console.log('pushed config mode =', config?.visualizerMode, '| page errors:', errors.length ? errors : 'none');
await browser.close();
