// Beat-FX feasibility probe (task-3 §3): can injected code reach Folia's motionSignals stores
// (beatImpact / downbeatImpact) from the production `?obs=1` bundle? Enumerates loaded ES chunks,
// searches their source text, then dynamically import()s candidates to inspect exports, and finally
// checks whether a setter path exists on the imported modules.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18084;
const TOKEN = 'beat-probe';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitForServer = child => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
  child.stdout.on('data', d => { if (String(d).includes('[spike-server]')) { clearTimeout(timer); resolve(); } });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
});

const main = async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitForServer(server);
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(`http://127.0.0.1:${PORT}/?obs=1&token=${TOKEN}`, { waitUntil: 'load', timeout: 45000 });
    await sleep(7000);

    const result = await page.evaluate(async () => {
      const urls = performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => /\.js(\?|$)/.test(u));
      const unique = [...new Set(urls)];
      const needles = ['beatImpact', 'downbeatImpact', 'motionSignals', 'beatPulse', 'beatStrength'];
      const textHits = [];
      for (const url of unique) {
        let text = '';
        try { text = await (await fetch(url)).text(); } catch (e) { continue; }
        const hit = {};
        for (const n of needles) if (text.includes(n)) hit[n] = (text.split(n).length - 1);
        if (Object.keys(hit).length) textHits.push({ url, bytes: text.length, hit });
      }
      // The module a chunk URL maps to: dynamic import() returns the same cached module instance
      // that the app itself got, so exported stores would be the live ones.
      const importResults = [];
      const candidates = textHits.map(h => h.url);
      const deep = [];
      for (const url of candidates) {
        try {
          const mod = await import(url);
          const exports = Object.keys(mod || {});
          // Look for MotionValue-like / store-like exports and anything mentioning beat.
          const details = [];
          for (const k of exports.slice(0, 200)) {
            const v = mod[k];
            const t = v === null ? 'null' : typeof v;
            const d = { k, t };
            if (v && typeof v === 'object') {
              const keys = Object.keys(v).slice(0, 40);
              d.keys = keys;
              d.hasGet = typeof v.get === 'function';
              d.hasSet = typeof v.set === 'function';
              d.hasOn = typeof v.on === 'function';
              const beatKeys = keys.filter(x => /beat|impact|motion|signal/i.test(x));
              if (beatKeys.length) d.beatKeys = beatKeys;
              // one level deeper: objects with .get/.set or names matching beat
              const nested = [];
              for (const kk of keys.slice(0, 40)) {
                const vv = v[kk];
                if (vv && typeof vv === 'object' && (typeof vv.get === 'function' || typeof vv.set === 'function')) {
                  nested.push({ key: kk, keys: Object.keys(vv).slice(0, 20), hasGet: typeof vv.get, hasSet: typeof vv.set });
                }
              }
              if (nested.length) d.motionValues = nested;
            } else if (v && (t === 'function')) {
              d.name = (v.name || '').slice(0, 40);
              d.len = v.length;
            }
            if (d.hasGet || d.hasSet || d.motionValues || d.beatKeys || (d.keys && d.keys.some(x => /beat|impact|motion/i.test(x)))) details.push(d);
          }
          importResults.push({ url, exports, exportTypes: [], deepDetails: details });
          if (url.includes('playerOverlayLayout')) {
            // Candidate beat driver exports found by static analysis of the export map:
            //   `ri as H` (update envelope from audio+time) and `qr as R` (inject beat events).
            const probe = { H: typeof mod.H, R: typeof mod.R };
            const call = {};
            try { const r = mod.H({ power: 180, bands: { bass: 200, lowMid: 150, mid: 120, vocal: 140, treble: 90 } }, 1.25); call.H = 'ok:' + (r === undefined ? 'undefined' : typeof r); }
            catch (e) { call.H = 'throw:' + String(e).slice(0, 120); }
            try { const r = mod.R('probe-track', [{ time: 1.0, type: 'beat', strength: 0.9 }, { time: 1.5, type: 'downbeat', strength: 1 }], 'manual', '', 1); call.R = 'ok:' + (r === undefined ? 'undefined' : typeof r); }
            catch (e) { call.R = 'throw:' + String(e).slice(0, 120); }
            importResults.push({ url, beatDriver: probe, beatCalls: call });
            deep.push({ url, details });
          }
        } catch (e) {
          importResults.push({ url, error: String(e).slice(0, 200) });
        }
      }
      // Report existing globals the app might expose (dev hooks etc.).
      return {
        chunkCount: unique.length,
        textHits,
        importResults,
        globals: Object.keys(window).filter(k => /folia|motion|beat|visualizer/i.test(k)).slice(0, 40),
        hasChromeWebview: !!(window.chrome && window.chrome.webview),
        moduleScripts: [...document.querySelectorAll('script[type=module]')].map(s => s.src).slice(0, 10),
      };
    });
    await page.screenshot({ path: path.join(OUT, 'beat-probe.png') });
    const report = { url: `http://127.0.0.1:${PORT}/?obs=1&token=${TOKEN}`, ...result, errors: errors.slice(0, 20) };
    fs.writeFileSync(path.join(OUT, 'beat-probe.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2).slice(0, 8000));
    await browser.close();
  } finally {
    server.kill('SIGKILL');
  }
};

main().catch(e => { console.error('BEAT PROBE FAILED:', e); process.exit(1); });
