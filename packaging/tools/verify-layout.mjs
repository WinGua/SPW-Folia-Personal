#!/usr/bin/env node
// Packaged-layout smoke test: run the SHIPPED helper (packaging/native) against the SHIPPED web
// payload (packaging/web) the way the plugin will, and verify the v1 interaction contract:
//   1. page loads from the virtual host mapping (no HTTP server, no service worker),
//   2. settings UI island is injected from web/settings/ and the bridge is available,
//   3. --open-settings opens the overlay on first run (bridgeReady path),
//   4. host command close-settings / open-settings drive __SPW_FOLIA__.ui (protocol §7.5),
//   5. ESC #1 with overlay open is owned by the settings UI: overlay closes, window stays open,
//   6. ESC #2 with overlay closed reaches the host: {"t":"closed","reason":"user"} + exit 0,
//   7. Folia renders lyric visuals from protocol state lines; screenshots land in packaging/out/.
//
// Usage: node packaging/tools/verify-layout.mjs [--no-open-settings]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES } from '../../poc/webview/shared/demoData.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = join(ROOT, 'packaging');
const OUT = join(PKG, 'out');
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const openSettings = !argv.includes('--no-open-settings');
const exe = join(PKG, 'native', 'spw-folia-host.exe');
for (const p of [exe, join(PKG, 'web', 'index.html'), join(PKG, 'web', 'settings', 'settings-ui.js')]) {
  if (!existsSync(p)) { console.error(`missing packaged file: ${p}\nrun: bash packaging/build-package.sh`); process.exit(2); }
}
const settings = JSON.parse(readFileSync(join(PKG, 'testdata', 'default-settings.json'), 'utf8'));
if (typeof settings.smartBeat === 'boolean') settings.smartBeat = { enabled: settings.smartBeat, effects: {} };

const LOOP_SECONDS = 16;
const lyrics = {
  lines: LINES.map((l) => ({
    startMs: Math.round(l.startTime * 1000),
    endMs: Math.round(l.endTime * 1000),
    main: l.fullText,
    sub: l.translation || '',
    cells: (l.words || []).map((w) => ({ startMs: Math.round(w.startTime * 1000), endMs: Math.round(w.endTime * 1000), text: w.text })),
  })),
  offsetMs: 0,
};
const track = { id: 'spike-track', title: 'Spike Track', artist: 'WEBVIEW-SPIKE', album: 'Spike Album', durationMs: LOOP_SECONDS * 1000 };

const args = [
  '--bundle', join(PKG, 'web'),
  '--settings-dir', join(PKG, 'web', 'settings'),
  '--settings-entry', 'settings-ui.js',
  '--window', '1600x900',
  '--user-data-dir', join(OUT, 'webview2-userdata'),
  '--fps-log', join(OUT, 'packaged-fps.log'),
];
if (openSettings) args.push('--open-settings');

const report = {
  startedAt: new Date().toISOString(), exe, args, openSettings, messages: {}, ready: null, closed: null,
  probes: {}, evalResults: [], screenshots: [], hostLogLines: [], consoleErrors: 0, checks: {}, pass: false,
};
const child = spawn(exe, args, { cwd: PKG, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => {});

const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* host gone */ } };
const t0 = Date.now();
let buf = '';
let flowStarted = false;
let stateTimer = null;
const fps = [];
const stderrChunks = [];
child.stderr.on('data', (d) => stderrChunks.push(d.toString()));

child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const t = msg.t;
    report.messages[t] = (report.messages[t] || 0) + 1;
    if (t === 'ready') { report.ready = { ...msg, atMs: Date.now() - t0 }; startFlow(); }
    else if (t === 'closed') report.closed = msg;
    else if (t === 'fps') fps.push({ fps: msg.fps, heapMB: msg.heapMB, atMs: Date.now() - t0 });
    else if (t === 'eval-result') report.evalResults.push(msg.value);
    else if (t === 'log') {
      const s = String(msg.msg || '');
      if (msg.level === 'error' || s.includes('console-error') || s.includes('js-error') || s.includes('js-rejection')) report.consoleErrors++;
      if (report.hostLogLines.length < 400) report.hostLogLines.push(line);
    }
  }
});

function startFlow() {
  if (flowStarted) return;
  flowStarted = true;
  report.timing = { spawnToReadyMs: report.ready.atMs };
  send({ t: 'hello', protocol: 1, pluginVersion: 'verify-layout', spwVersion: '1.19.0' });
  send({ t: 'settings', settings });
  send({ t: 'lyrics', ...lyrics });
  send({ t: 'track', ...track });
  const anchor = Date.now();
  stateTimer = setInterval(() => {
    send({ t: 'state', posMs: Math.round((Date.now() - anchor) % (LOOP_SECONDS * 1000)), durationMs: LOOP_SECONDS * 1000, playing: true, rate: 1, tsMs: Date.now() });
  }, 100);

  const shot = (name) => send({ t: 'command', command: 'screenshot', path: join(OUT, name) });
  const evalJs = (script) => send({ t: 'command', command: 'eval', script });
  const probe = () => evalJs("JSON.stringify({hasUi: !!window.__SPW_FOLIA_SETTINGS_UI__, hasBridge: !!window.__SPW_FOLIA__, uiApi: !!(window.__SPW_FOLIA__ && window.__SPW_FOLIA__.ui && window.__SPW_FOLIA__.ui.isSettingsOpen), open: !!(window.__SPW_FOLIA__ && window.__SPW_FOLIA__.ui && window.__SPW_FOLIA__.ui.isSettingsOpen && window.__SPW_FOLIA__.ui.isSettingsOpen()), canvases: document.querySelectorAll('canvas').length, settingsScripts: [...document.scripts].map(s=>s.src).filter(s=>s.indexOf('spw-folia-settings.local')>=0).length})");
  const esc = () => evalJs("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); JSON.stringify({esc:'dispatched'})");

  setTimeout(probe, 4200);                                             // probe1: first-run state
  setTimeout(() => shot('packaged-firstrun-settings.png'), 5200);
  setTimeout(() => send({ t: 'command', command: 'close-settings' }), 5600); // §7.5 host command
  setTimeout(probe, 6100);                                             // probe2: closed by command
  setTimeout(() => send({ t: 'command', command: 'open-settings' }), 6400);  // §7.5 host command
  setTimeout(probe, 6900);                                             // probe3: re-opened by command
  setTimeout(esc, 7400);                                               // ESC #1: settings UI consumes it
  setTimeout(probe, 8000);                                             // probe4: overlay closed, window alive
  setTimeout(() => shot('packaged-visualizer.png'), 8300);
  setTimeout(esc, 8800);                                               // ESC #2: host closes window
  setTimeout(() => { send({ t: 'quit' }); }, 13000);                   // fallback if still alive
}

child.on('exit', (code) => {
  clearInterval(stateTimer);
  report.exitCode = code;
  report.stderr = stderrChunks.join('');
  const nums = fps.map((f) => f.fps);
  report.fps = {
    samples: nums.length,
    min: nums.length ? Math.min(...nums) : 0,
    median: median(nums),
    max: nums.length ? Math.max(...nums) : 0,
    heapMaxMB: Math.max(0, ...fps.map((f) => f.heapMB || 0)),
  };
  report.probes = parseProbes(report);
  const p = report.probes;
  report.checks = {
    exitedZero: code === 0,
    closedUser: !!(report.closed && report.closed.reason === 'user'),
    bridgePresent: !!(p.probe1 && p.probe1.hasBridge && p.probe1.uiApi),
    settingsInjected: !!(p.probe1 && p.probe1.hasUi && p.probe1.settingsScripts === 1),
    settingsAutoOpened: report.openSettings ? !!(p.probe1 && p.probe1.open) : null,
    closeSettingsCommand: !!(p.probe2 && p.probe2.open === false),
    openSettingsCommand: !!(p.probe3 && p.probe3.open === true),
    escClosedSettingsOnly: !!(p.probe4 && p.probe4.open === false),
    visualizerCanvases: !!(p.probe1 && p.probe1.canvases > 0),
    noConsoleErrors: report.consoleErrors === 0,
  };
  report.screenshots = ['packaged-firstrun-settings.png', 'packaged-visualizer.png'].map((n) => {
    const path = join(OUT, n);
    let bytes = 0;
    try { bytes = readFileSync(path).length; } catch { bytes = 0; }
    return { name: n, path, bytes };
  });
  const screenshotsPresent = report.screenshots.every((s) => s.bytes > 10000);
  report.screenshotsPresent = screenshotsPresent;
  const c = report.checks;
  report.pass = c.exitedZero && c.closedUser && c.bridgePresent && c.settingsInjected && c.closeSettingsCommand
    && c.openSettingsCommand && c.escClosedSettingsOnly && c.visualizerCanvases && c.noConsoleErrors && screenshotsPresent
    && (!report.openSettings || c.settingsAutoOpened);
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, 'verify-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    pass: report.pass, checks: report.checks, exitCode: report.exitCode, closed: report.closed && report.closed.reason,
    timing: report.timing, fps: report.fps, probes: report.probes, consoleErrors: report.consoleErrors,
    screenshots: report.screenshots.map((s) => `${s.name}:${s.bytes}`), stderr: report.stderr.slice(0, 300),
  }, null, 2));
  process.exit(report.pass ? 0 : 1);
});

setTimeout(() => { report.timedOut = true; try { child.kill(); } catch { /* ignore */ } }, 22000).unref();

function unwrap(x) {
  for (let i = 0; i < 4 && typeof x === 'string'; i++) {
    try { x = JSON.parse(x); } catch { break; }
  }
  return x;
}
function parseProbes(rep) {
  const vals = (rep.evalResults || []).map(unwrap);
  const obj = (v) => (v && typeof v === 'object' ? v : null);
  // eval result order: probe1, probe2, probe3, esc1, probe4, esc2 (close/open commands have no eval result)
  return { raw: rep.evalResults, probe1: obj(vals[0]), probe2: obj(vals[1]), probe3: obj(vals[2]), esc1: vals[3], probe4: obj(vals[4]), esc2: vals[5] };
}
function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return +(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2).toFixed(1);
}
