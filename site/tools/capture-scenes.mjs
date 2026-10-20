import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, SERVER_DIR, loadPlaywright } from './_env.mjs';

const { chromium } = loadPlaywright();
const OUT = path.join(ROOT, '.tmp-capture/raw');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 18372;

const child = spawn(process.execPath, [path.join(SERVER_DIR, 'server.mjs'), String(PORT)], { cwd: SERVER_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => setTimeout(r, 1500));

const GOLD = { name: 'Gold', backgroundColor: '#000000', primaryColor: '#ffe8bc', accentColor: '#ffb545', secondaryColor: '#fff3d6', fontStyle: 'serif', animationIntensity: 'normal' };
const AURORA = { name: 'Aurora', backgroundColor: '#000000', primaryColor: '#dfe9ff', accentColor: '#7f9dff', secondaryColor: '#eaf1ff', fontStyle: 'serif', animationIntensity: 'normal' };
const ROSE = { name: 'Rose', backgroundColor: '#000000', primaryColor: '#ffe1ea', accentColor: '#ff7fa8', secondaryColor: '#fff0f4', fontStyle: 'serif', animationIntensity: 'normal' };
const JADE = { name: 'Jade', backgroundColor: '#000000', primaryColor: '#d9fff0', accentColor: '#31c9a0', secondaryColor: '#e8fff8', fontStyle: 'serif', animationIntensity: 'normal' };

const backdrop = (a, b, c) => `
  <div style="position:fixed;inset:0;z-index:-1;background:
     radial-gradient(58% 62% at 22% 28%, ${a} 0%, rgba(0,0,0,0) 62%),
     radial-gradient(64% 68% at 76% 68%, ${b} 0%, rgba(0,0,0,0) 60%),
     radial-gradient(120% 100% at 50% 50%, ${c} 0%, #07060a 55%, #050409 100%);"></div>`;

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--window-size=1600,900', '--hide-scrollbars', '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required'],
});
const SIZE = { width: 1600, height: 900 };

async function scene(name, { mode, theme, bg, ms = 7000, wal }) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: SIZE, fps: 30 } });
  const page = await ctx.newPage();
  await page.route('**/obs/events*', async (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('mode', mode);
    u.searchParams.set('transparent', '1'); u.searchParams.set('bgmode', 'latent');
    if (theme) u.searchParams.set('theme', JSON.stringify(theme));
    await route.continue({ url: u.toString() });
  });
  if (bg) await page.addInitScript(`document.addEventListener('DOMContentLoaded',()=>{document.body.insertAdjacentHTML('afterbegin',${JSON.stringify(bg)})});`);
  if (wal) await page.addInitScript(`document.addEventListener('DOMContentLoaded',()=>{document.body.style.background='url(${wal}) center/cover no-repeat'})`);
  await page.goto(`http://127.0.0.1:${PORT}/?obs=1&token=spike-token`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 20000 });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(OUT, `${name}-poster.png`) });
  await page.waitForTimeout(ms);
  const v = page.video();
  await ctx.close();
  fs.renameSync(await v.path(), path.join(OUT, `${name}.webm`));
  console.log('RECORDED', name);
}

await scene('s2-aurora', { mode: 'lumiere', theme: AURORA, bg: backdrop('#12203a', '#2a1a3a', '#0a0d18'), ms: 7000 });
await scene('s3-tempera', { mode: 'tempera', theme: GOLD, bg: backdrop('#3a2210', '#2a1a10', '#120b08'), ms: 7000 });
await scene('s4-monet', { mode: 'monet', theme: JADE, bg: backdrop('#0d2a26', '#10303a', '#06120f'), ms: 7000 });
await scene('s5-diorama', { mode: 'diorama', theme: ROSE, bg: backdrop('#3a1220', '#2a1a3a', '#150810'), ms: 7000 });
await scene('s6-pendolo', { mode: 'pendolo', theme: GOLD, bg: backdrop('#2a2210', '#1a2410', '#0f0c06'), ms: 7000 });
// transparent overlay over a photographic desktop wallpaper: lyrics only
await scene('s7-overlay', { mode: 'lumiere', theme: GOLD, wal: '../../.tmp-capture/wall.jpg', ms: 8000 });

await browser.close();
child.kill('SIGKILL');
console.log('ALL DONE');
