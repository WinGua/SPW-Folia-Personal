// Beat-FX visual probe: can injected JS drive Folia's motionSignals beat envelope (exports H/R of
// playerOverlayLayout chunk) and produce a visible change in the OBS visualizer? Screenshots A/B +
// pixel diff via pngjs; writes out/beat-visual.json + out/beat-visual-{a,b}.png.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18085;
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitForServer = child => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
  child.stdout.on('data', d => { if (String(d).includes('[spike-server]')) { clearTimeout(timer); resolve(); } });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
});

const diffPct = (a, b) => {
  const A = PNG.sync.read(fs.readFileSync(a));
  const B = PNG.sync.read(fs.readFileSync(b));
  if (A.width !== B.width || A.height !== B.height) return { error: 'size mismatch' };
  let changed = 0, total = 0, sum = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    sum += d;
    if (d > 24) changed++;
    total++;
  }
  return { changedPct: +((changed / total) * 100).toFixed(2), meanAbsDiff: +(sum / total / 3).toFixed(2) };
};

const main = async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitForServer(server);
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${PORT}/?obs=1&token=beat-visual`, { waitUntil: 'load', timeout: 45000 });
    await sleep(6000);
    await page.screenshot({ path: path.join(OUT, 'beat-visual-a.png') });

    const info = await page.evaluate(async () => {
      const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => /playerOverlayLayout.*\.js/.test(u));
      if (!urls.length) return { error: 'chunk not loaded' };
      const url = urls[0];
      const mod = await import(url);
      const clock = (window.__SPW_FOLIA__ && window.__SPW_FOLIA__.getLastClock && window.__SPW_FOLIA__.getLastClock()) || null;
      const nowS = clock ? clock.currentTime : 0;
      window.__beatProbe = { mod, calls: 0, errors: [] };
      try {
        mod.R('probe', [
          { time: nowS, type: 'beat', strength: 1 },
          { time: nowS + 0.5, type: 'beat', strength: 1 },
          { time: nowS + 1.0, type: 'downbeat', strength: 1 },
          { time: nowS + 1.5, type: 'beat', strength: 1 },
        ], 'manual', '', 1.4);
      } catch (e) { window.__beatProbe.errors.push('R:' + String(e)); }
      window.__beatTimer = setInterval(() => {
        try {
          mod.H({ power: 230, bands: { bass: 245, lowMid: 220, mid: 210, vocal: 190, treble: 150 } }, (window.__SPW_FOLIA__.getLastClock ? window.__SPW_FOLIA__.getLastClock().currentTime : 0));
          window.__beatProbe.calls++;
        } catch (e) { if (window.__beatProbe.errors.length < 5) window.__beatProbe.errors.push(String(e)); }
      }, 16);
      return { url, clockNow: nowS, hasR: typeof mod.R, hasH: typeof mod.H };
    });
    await sleep(2600);
    await page.screenshot({ path: path.join(OUT, 'beat-visual-b.png') });
    const calls = await page.evaluate(() => ({ calls: window.__beatProbe.calls, errors: window.__beatProbe.errors.slice(0, 5) }));
    const diff = diffPct(path.join(OUT, 'beat-visual-a.png'), path.join(OUT, 'beat-visual-b.png'));
    const report = { ...info, ...calls, diff, note: 'A=baseline B=with injected H/R beat driver over ~2.6s; audio SSE still flowing in both.' };
    fs.writeFileSync(path.join(OUT, 'beat-visual.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
  } finally { server.kill('SIGKILL'); }
};
main().catch(e => { console.error('BEAT VISUAL FAILED:', e); process.exit(1); });
