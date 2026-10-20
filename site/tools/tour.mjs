import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { ROOT, loadPlaywright } from './_env.mjs';

const { chromium } = loadPlaywright();
const SITE = path.join(ROOT, 'site');
const RAW = path.join(ROOT, '.tmp-capture/site-raw');
fs.mkdirSync(RAW, { recursive: true });
const PORT = 18905;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1'],
});
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
// hide the mouse pointer artifacts and the scrollbar gutter
await page.addStyleTag({ content: 'html{scrollbar-width:none}::-webkit-scrollbar{display:none}' });

const scrollTo = async (y, ms = 1700) => {
  await page.evaluate(({ yy, mm }) => new Promise((res) => {
    const y0 = window.scrollY, dy = yy - y0, t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (t) => {
      const p = Math.min(1, (t - t0) / mm);
      window.scrollTo(0, y0 + dy * ease(p));
      if (p < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  }), { yy: y, mm: ms });
};
const top = (sel, off = 0) => page.evaluate(({ s, o }) => {
  const el = document.querySelector(s);
  return Math.max(0, el.getBoundingClientRect().top + window.scrollY - o);
}, { s: sel, o: off });
const tileCenter = (i) => page.evaluate((k) => {
  const r = document.querySelectorAll('.tile')[k].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, i);

/* ── 1. hero ─────────────────────────────────────────────────── */
await page.waitForFunction(() => {
  const v = document.querySelector('.hero-video');
  return v && v.readyState >= 2 && v.currentTime > 0.15;
}, { timeout: 30000 }).catch(() => {});
await sleep(4200);                       // let the hero breathe

/* ── 2. real Folia ───────────────────────────────────────────── */
await scrollTo(await top('#real', 40), 2000);
await sleep(3400);                       // reel plays, three facts settle

/* ── 3. styles grid ──────────────────────────────────────────── */
await scrollTo(await top('#styles', 30), 1900);
await sleep(1600);
for (const i of [0, 3, 6, 9]) {          // diagonal hover tour
  const { x, y } = await tileCenter(i);
  await page.mouse.move(x, y, { steps: 14 });
  await sleep(720);
}
await sleep(900);

/* ── 4. lightbox on the showiest style ───────────────────────── */
{
  const { x, y } = await tileCenter(2);   // lumiere 绘光
  await page.mouse.move(x, y, { steps: 10 });
  await sleep(340);
  await page.mouse.click(x, y);
  await sleep(3600);
  await page.keyboard.press('Escape');
  await sleep(1100);
}

/* ── 5. smooth stats ─────────────────────────────────────────── */
await scrollTo(await top('#smooth', 30), 1850);
await sleep(3400);                       // counters finish, sweep line passes

/* ── 6. desktop overlay ──────────────────────────────────────── */
await scrollTo(await top('#overlay', 40), 1850);
await sleep(3800);

/* ── 7. settings ─────────────────────────────────────────────── */
await scrollTo(await top('#settings', 40), 1700);
await sleep(3000);

/* ── 8. install ──────────────────────────────────────────────── */
await scrollTo(await top('#install', 30), 1750);
await sleep(3400);

/* ── 9. closing band + footer ────────────────────────────────── */
await scrollTo(await page.evaluate(() => document.body.scrollHeight - window.innerHeight), 2100);
await sleep(3200);

const vid = page.video();
await ctx.close();
await browser.close();
server.close();
const dst = path.join(RAW, 'tour.webm');
fs.renameSync(await vid.path(), dst);
console.log('errors:', errs.length ? errs : 'none');
console.log('video:', dst, fs.statSync(dst).size);
