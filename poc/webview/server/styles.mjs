// Sweep all 14 Folia visualizerMode values through the production OBS browser surface.
// For each mode: load ?obs=1&token=...&mode=X in headless Edge (Playwright), wait, measure FPS,
// screenshot to out/styles/<mode>.png, analyze pixels (blank/flat detection), collect console
// errors + non-local network requests. Writes out/styles/report.json + prints a table.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18081;
const TOKEN = 'spike-token';
const OUT = path.join(__dirname, 'out', 'styles');
fs.mkdirSync(OUT, { recursive: true });
const MODES = ['sonnet', 'tempera', 'lumiere', 'diorama', 'pendolo', 'monet', 'fume', 'cappella', 'partita', 'claddagh', 'cadenza', 'tilt', 'still', 'window', 'classic'];
const ONLY = process.argv.slice(2);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const FPS_METER = `(() => {
  window.__spike = { frames: 0, last: 0, samples: [], longFrames: 0, t0: performance.now() };
  const loop = (t) => {
    const s = window.__spike;
    if (s.last) { s.frames++; const dt = t - s.last; if (dt > 25) s.longFrames++; }
    s.last = t;
    const elapsed = t - s.t0;
    if (elapsed >= 1000) { s.samples.push(+(s.frames * 1000 / elapsed).toFixed(1)); s.frames = 0; s.t0 = t; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();`;

function analyzePng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const step = 4; // sample every 4th pixel in each axis for speed
  let n = 0, sum = 0, sum2 = 0;
  const hist = new Map(); // coarse 5-bit-per-channel bucket
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++; sum += lum; sum2 += lum * lum;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      hist.set(key, (hist.get(key) || 0) + 1);
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const buckets = [...hist.values()].sort((a, b) => b - a);
  const dominant = buckets[0] / n;
  return {
    meanLum: +mean.toFixed(1),
    stdLum: +std.toFixed(1),
    colorBuckets: hist.size,
    dominantRatio: +dominant.toFixed(3),
    // "flat" = almost one color across the frame (blank/unpainted)
    flat: std < 3 || dominant > 0.995,
  };
}

const waitForServer = (child) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
  child.stdout.on('data', d => { if (String(d).includes('[spike-server]')) { clearTimeout(timer); resolve(); } });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
});

const main = async () => {
  const modes = ONLY.length ? ONLY : MODES;
  const server = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--window-size=1920,1080', '--enable-precise-memory-info', '--hide-scrollbars', '--disable-gpu-vsync'] });
  const results = [];
  try {
    await waitForServer(server);
    for (const mode of modes) {
      const t0 = Date.now();
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.addInitScript(FPS_METER);
      const errors = [];
      const external = new Set();
      const failed = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
      page.on('pageerror', e => errors.push('[pageerror] ' + String(e.message).slice(0, 300)));
      page.on('requestfailed', r => failed.push(`${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`));
      page.on('request', r => {
        try { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) external.add(r.url().slice(0, 200)); } catch {}
      });
      const url = `http://127.0.0.1:${PORT}/?obs=1&token=${TOKEN}&mode=${mode}`;
      let loadError = null;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      } catch (e) { loadError = String(e.message); }
      let sawCanvas = false;
      try { await page.waitForSelector('canvas', { timeout: 12000 }); sawCanvas = true; } catch {}
      await sleep(5000);
      const probe = await page.evaluate(() => {
        const s = window.__spike || {};
        const canvases = [...document.querySelectorAll('canvas')];
        return {
          fpsSamples: s.samples || [],
          longFrames: s.longFrames ?? null,
          heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
          canvases: canvases.length,
          canvasInfo: canvases.map(c => ({ w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight })),
          bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
          webgl: (() => { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2') || !!c.getContext('webgl'); } catch { return false; } })(),
          hasWorker: typeof Worker !== 'undefined',
        };
      }).catch(e => ({ error: String(e.message) }));
      const shot = path.join(OUT, `${mode}.png`);
      try { await page.screenshot({ path: shot }); } catch (e) { console.error(mode, 'screenshot failed', e.message); }
      const pixels = fs.existsSync(shot) ? analyzePng(shot) : null;
      const fps = probe.fpsSamples || [];
      const fpsAvg = fps.length ? +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1) : null;
      const rec = {
        mode, canvasOk: sawCanvas && probe.canvases > 0, loadError,
        fpsAvg, fpsSamples: fps, longFrames: probe.longFrames,
        heapMB: probe.heapMB, canvases: probe.canvases, canvasInfo: probe.canvasInfo, webgl: probe.webgl,
        body: probe.bodyText,
        pixels,
        errors: errors.slice(0, 8),
        externalRequests: [...external].slice(0, 8),
        failedRequests: [...new Set(failed)].slice(0, 8),
        spawnMs: Date.now() - t0,
      };
      results.push(rec);
      const ok = rec.canvasOk && pixels && !pixels.flat && !loadError;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${mode.padEnd(9)} fps=${String(fpsAvg).padStart(5)} heap=${String(rec.heapMB).padStart(5)}MB std=${pixels ? pixels.stdLum : '-'} buckets=${pixels ? pixels.colorBuckets : '-'} ext=${rec.externalRequests.length} err=${rec.errors.length} ${loadError ? 'LOADERR=' + loadError : ''} ${rec.errors[0] ? 'ERR=' + rec.errors[0].slice(0, 120) : ''}`);
      await page.close();
    }
    const report = { generatedAt: new Date().toISOString(), port: PORT, results };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    const good = results.filter(r => r.canvasOk && r.pixels && !r.pixels.flat && !r.loadError);
    console.log(`\n${good.length}/${results.length} styles rendered. Report: ${path.join(OUT, 'report.json')}`);
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGKILL');
  }
};

main().catch(e => { console.error('SWEEP FAILED:', e); process.exit(1); });
