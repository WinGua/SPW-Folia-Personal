// Beat chain probe: can injected JS drive Folia's beat engine end to end? Imports the loaded
// playerOverlayLayout chunk and exercises the internal driver exports:
//   A()/E()/R()/H()/G()/Q()/$()/V()  (state, set-track, set-events, envelope update, debug, last beat...)
// Reports mutations + counters, so we know whether an injected driver is technically functional.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18086;
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
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(`http://127.0.0.1:${PORT}/?obs=1&token=beat-chain`, { waitUntil: 'load', timeout: 45000 });
    await sleep(6000);
    const result = await page.evaluate(async () => {
      const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => /playerOverlayLayout.*\.js/.test(u));
      const mod = await import(urls[0]);
      const log = { exports: Object.keys(mod).sort(), steps: [] };
      const rec = (name, v) => log.steps.push({ name, value: typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v });
      rec('A_before', mod.A());
      // set current track key, inject beat events, then drive the envelope from a fake media element.
      try { rec('E_set_track', String(mod.E('spw-probe'))); } catch (e) { rec('E_set_track_err', String(e)); }
      const events = [];
      for (let i = 0; i < 16; i++) events.push({ t: i * 0.5, kind: i % 4 === 0 ? 'downbeat' : 'beat', impact: 1 });
      try { rec('R_set_events', String(mod.R('spw-probe', events, 'probe', 'injected', 1.4))); } catch (e) { rec('R_set_events_err', String(e)); }
      rec('A_after', mod.A());
      // H(mediaLike, t): media element supplies currentTime; second arg feeds latency calc only.
      const fake = { paused: false, ended: false, currentTime: 0, outputLatency: 0, baseLatency: 0 };
      for (let i = 0; i < 12; i++) {
        fake.currentTime = 0.05 + i * 0.16;
        try { mod.H(fake, fake.currentTime); } catch (e) { rec('H_err', String(e)); break; }
      }
      try { rec('G_debug', mod.G()); } catch (e) { rec('G_debug_err', String(e)); }
      try { rec('Q_lastBeat', mod.Q()); } catch (e) { rec('Q_lastBeat_err', String(e)); }
      try { rec('$_lastDownbeat', mod.$ ? mod.$() : 'no-export'); } catch (e) { rec('$_err', String(e)); }
      try { rec('K_trackScale', mod.K ? mod.K() : 'no-export'); } catch (e) { rec('K_err', String(e)); }
      return log;
    });
    const report = { result, errors: errors.slice(0, 10) };
    fs.writeFileSync(path.join(OUT, 'beat-chain.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2).slice(0, 6000));
    await browser.close();
  } finally { server.kill('SIGKILL'); }
};
main().catch(e => { console.error('BEAT CHAIN FAILED:', e); process.exit(1); });
