import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, SERVER_DIR, loadPlaywright } from './_env.mjs';

const { chromium } = loadPlaywright();
const OUT = path.join(ROOT, '.tmp-capture/raw');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 18370;

const child = spawn(process.execPath, [path.join(SERVER_DIR, 'server.mjs'), String(PORT)], { cwd: SERVER_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => process.stdout.write('[srv] ' + d));
await new Promise(r => setTimeout(r, 1500));

const GOLD = { name: 'Gold', backgroundColor: '#000000', primaryColor: '#ffe8bc', accentColor: '#ffb545', secondaryColor: '#fff3d6', fontStyle: 'serif', animationIntensity: 'normal' };

// Designed backdrop: warm candle lit room gradient, never flat black.
const BACKDROP = `
  <div style="position:fixed;inset:0;z-index:-1;background:
     radial-gradient(58% 62% at 22% 28%, #3a2210 0%, rgba(58,34,16,0) 62%),
     radial-gradient(64% 68% at 76% 68%, #1b2a3a 0%, rgba(27,42,58,0) 60%),
     radial-gradient(120% 100% at 50% 50%, #120b08 0%, #07060a 55%, #050409 100%);"></div>`;

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--window-size=1600,900', '--hide-scrollbars', '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required'],
});

const SIZE = { width: 1600, height: 900 };

async function record(name, { mode, theme, transparent, backdrop, ms, fps = 30 }) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: SIZE, fps } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 120)));
  await page.route('**/obs/events*', async (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('mode', mode);
    if (transparent) { u.searchParams.set('transparent', '1'); u.searchParams.set('bgmode', 'latent'); }
    if (theme) u.searchParams.set('theme', JSON.stringify(theme));
    await route.continue({ url: u.toString() });
  });
  if (backdrop) await page.addInitScript(`document.addEventListener('DOMContentLoaded',()=>{document.body.insertAdjacentHTML('afterbegin',${JSON.stringify(backdrop)})});`);
  await page.goto(`http://127.0.0.1:${PORT}/?obs=1&token=spike-token`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 20000 });
  // let the renderer settle a full screen (fog/beams ramp in)
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(OUT, `${name}-poster.png`) });
  await page.waitForTimeout(ms);
  const v = page.video();
  await ctx.close();
  const p = await v.path();
  const dest = path.join(OUT, `${name}.webm`);
  fs.renameSync(p, dest);
  console.log('RECORDED', dest, (fs.statSync(dest).size / 1048576).toFixed(2) + 'MB');
}

// 1) hero: gold lumiere, one full 16s lyric loop
await record('hero', { mode: 'lumiere', theme: GOLD, transparent: true, backdrop: BACKDROP, ms: 16500 });

// 2) transparent overlay demo: over a photographic desktop, lyrics only
await record('overlay', { mode: 'lumiere', theme: GOLD, transparent: true, ms: 9000 });

// 3) dark neutral: tempera on the default midnight theme (for the gallery / section bg)
await record('sonnet', { mode: 'sonnet', ms: 8000 });

await browser.close();
child.kill('SIGKILL');
console.log('ALL DONE');
