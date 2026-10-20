/*
 * capture-styles.mjs — render every Folia style through the real visualizer and
 * keep the richest still per style.
 *
 * The demo track is a 16 s loop with four lyric lines (0–3.6, 4–7.8, 8.2–11.6,
 * 12–15.6 s). Styles that animate character by character look almost empty at a
 * line boundary, and a random sample mostly lands on a boundary — which is why
 * random sampling produced half-empty frames.
 *
 * The spike server derives `currentTime` from its own start time
 * (`(Date.now() - startedAt) / 1000 % 16`), so the lyric phase is predictable:
 * we record the wall clock right before spawning the server, wait until the
 * clock hits the middle of each lyric line, and screenshot there. Four known
 * good phases beat fifteen random ones.
 *
 * Usage:  node site/tools/capture-styles.mjs [outDir] [mode,mode,...] [phases]
 * Needs:  poc/webview/dist/ (the Folia bundle; gitignored) and
 *         poc/webview/server/node_modules/.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, SERVER_DIR, loadPlaywright, loadPng } from './_env.mjs';

const { chromium } = loadPlaywright();
const PNG = loadPng();

const ALL_MODES = [
  'sonnet', 'tempera', 'lumiere', 'classic', 'cadenza', 'partita', 'fume',
  'tilt', 'claddagh', 'monet', 'pendolo', 'cappella', 'diorama', 'still',
];

const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.tmp-capture/scan'));
const MODES = process.argv[3] ? process.argv[3].split(',').filter(Boolean) : ALL_MODES;
/* Mid-line phases: line 1 at 2.2 s, line 2 at 6.2 s, line 3 at 10.2 s, line 4 at 14.2 s. */
const PHASES = (process.argv[4] || '2.2,6.2,10.2,14.2').split(',').map(Number);

const PORT = 18396;
const W = 1920, H = 1080;
const WARM_MS = 1500;     // let the renderer mount before the first phase
const LOOP = 16.0;

/* tempera and monet paint their own opaque backdrop (tempera a paper ground,
 * monet the cover art), so a transparent stage leaves an opaque box floating in
 * the middle of the frame. Let those two draw their own background instead. */
const OPAQUE = new Set(['tempera', 'monet']);

/* Candle-gold theme: the accent the promo site is built around. */
const GOLD = {
  name: 'Gold',
  backgroundColor: '#000000',
  primaryColor: '#ffe8bc',
  accentColor: '#ffb545',
  secondaryColor: '#fff3d6',
  fontStyle: 'serif',
  animationIntensity: 'normal',
};

/* Drawn behind the transparent renderer so frames never sit on flat black. */
const BACKDROP = `<div style="position:fixed;inset:0;z-index:-1;background:
   radial-gradient(58% 62% at 22% 28%, #3a2210 0%, rgba(0,0,0,0) 62%),
   radial-gradient(64% 68% at 76% 68%, #1b2a3a 0%, rgba(0,0,0,0) 60%),
   radial-gradient(120% 100% at 50% 50%, #120b08 0%, #07060a 55%, #050409 100%);"></div>`;

/* Score a frame by how much glowing lyric it carries, measured only in the
 * middle band of the image (where the lyric baseline sits) and favouring warm
 * pixels, so a bright starfield or a bright background cannot outrank a fully
 * lit line. */
function score(buf) {
  const { width, height, data } = PNG.sync.read(buf);
  const y0 = Math.floor(height * 0.24);
  const y1 = Math.floor(height * 0.78);
  let lit = 0, warm = 0, n = 0, sum = 0, sum2 = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += l;
      sum2 += l * l;
      n++;
      if (l > 120) {
        lit++;
        if (r >= g && g >= b) warm++;
      }
    }
  }
  const mean = sum / n;
  const dev = Math.max(0, sum2 / n - mean * mean);
  return Math.sqrt(dev) * 2 + (lit / n) * 240 + (warm / n) * 620;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

fs.mkdirSync(OUT, { recursive: true });

/* The server's lyric clock starts when the process starts; record the wall
 * clock first so we can aim at a phase. */
const serverEpoch = Date.now();
const child = spawn(process.execPath, [path.join(SERVER_DIR, 'server.mjs'), String(PORT)], {
  cwd: SERVER_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
});
await sleep(1600);

/* Milliseconds until the server clock next reaches `phase` seconds. */
function msUntil(phase) {
  const t = ((Date.now() - serverEpoch) / 1000) % LOOP;
  let d = phase - t;
  if (d < 0) d += LOOP;
  return d * 1000;
}

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: [`--window-size=${W},${H}`, '--hide-scrollbars', '--disable-gpu-vsync'],
});

const report = [];
try {
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();

    const opaque = OPAQUE.has(mode);

    await page.route('**/obs/events*', async (route) => {
      const u = new URL(route.request().url());
      u.searchParams.set('mode', mode);
      if (!opaque) {
        u.searchParams.set('transparent', '1');
        u.searchParams.set('bgmode', 'latent');
      }
      u.searchParams.set('theme', JSON.stringify(GOLD));
      await route.continue({ url: u.toString() });
    });

    await page.addInitScript(
      `document.addEventListener('DOMContentLoaded',()=>{document.body.insertAdjacentHTML('afterbegin',${JSON.stringify(BACKDROP)})});`,
    );

    await page.goto(`http://127.0.0.1:${PORT}/?obs=1&token=spike-token`, { waitUntil: 'load' });
    let canvasOk = true;
    try {
      await page.waitForSelector('canvas', { timeout: 15000 });
    } catch {
      canvasOk = false;
      console.warn(`\n  ! ${mode}: canvas slow, continuing`);
    }
    await sleep(WARM_MS);

    let best = { score: -1, buf: null, phase: -1 };
    for (const phase of PHASES) {
      await sleep(msUntil(phase));
      const buf = await page.screenshot();
      const s = score(buf);
      if (s > best.score) best = { score: s, buf, phase };
    }

    fs.writeFileSync(path.join(OUT, `${mode}.png`), best.buf);
    report.push({ mode, phase: best.phase, score: Math.round(best.score), canvasOk });
    console.log(`${mode.padEnd(10)} phase ${String(best.phase).padStart(5)}s  score ${Math.round(best.score)}`);

    await ctx.close();
  }
} finally {
  await browser.close();
  child.kill('SIGKILL');
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\ncaptured ${MODES.length} styles at mid-line phases -> ${OUT}`);
