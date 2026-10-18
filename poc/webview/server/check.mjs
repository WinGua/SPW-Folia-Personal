// Browser bring-up check for Folia's production OBS bundle: launch Edge (Playwright channel),
// load the real `?obs=1` surface fed by server.mjs, wait for a lyric line, screenshot, measure FPS.
// Emits report.json + screenshot.png next to this file.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18080;
const TOKEN = 'spike-token';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const waitForServer = (child) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
  child.stdout.on('data', d => { if (String(d).includes('[spike-server]')) { clearTimeout(timer); resolve(); } });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

const FPS_METER = `(() => {
  window.__spike = { frames: 0, last: 0, samples: [], longFrames: 0, t0: performance.now() };
  const loop = (t) => {
    const s = window.__spike;
    if (s.last) { s.frames++; const dt = t - s.last; if (dt > 25) s.longFrames++; }
    s.last = t;
    const elapsed = t - s.t0;
    if (elapsed >= 1000) {
      s.samples.push(+(s.frames * 1000 / elapsed).toFixed(1));
      s.frames = 0; s.t0 = t;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();`;

const main = async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitForServer(server);
    const browser = await chromium.launch({
      channel: 'msedge',
      headless: true,
      args: ['--window-size=1920,1080', '--enable-precise-memory-info', '--hide-scrollbars'],
    });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.addInitScript(FPS_METER);
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
    const url = `http://127.0.0.1:${PORT}/?obs=1&token=${TOKEN}`;
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await sleep(7000);

    const probe = await page.evaluate(() => {
      const s = window.__spike || {};
      const gl = document.querySelector('canvas');
      const canvasInfo = gl ? { w: gl.width, h: gl.height, cssW: gl.clientWidth, cssH: gl.clientHeight } : null;
      return {
        fpsSamples: s.samples, longFrames: s.longFrames,
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        canvas: canvasInfo,
        bodyText: document.body.innerText.slice(0, 300),
        title: document.title,
        canvases: document.querySelectorAll('canvas').length,
        chromeWebview: typeof window.chrome?.webview,
      };
    });
    await page.screenshot({ path: path.join(OUT, 'browser-sonnet-1920x1080.png') });
    // A second shot later in the loop, to sample another lyric line.
    await sleep(4200);
    const probe2 = await page.evaluate(() => ({ fpsSamples: (window.__spike || {}).samples, longFrames: (window.__spike || {}).longFrames }));
    await page.screenshot({ path: path.join(OUT, 'browser-sonnet-late.png') });

    const report = { url, ...probe, late: probe2, errors: errors.slice(0, 30) };
    fs.writeFileSync(path.join(OUT, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
  } finally {
    server.kill('SIGKILL');
  }
};

main().catch(e => { console.error('CHECK FAILED:', e); process.exit(1); });
