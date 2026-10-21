#!/usr/bin/env node
// Playback-control channel smoke test (v0.3.0): run the SHIPPED helper + SHIPPED web payload and
// verify the §3.1 `control` / §3.2 `queue` / §3.4 channel end-to-end WITHOUT the SPW plugin:
//   1. the injected settings island receives a `queue` line and renders the playback bar + queue panel,
//   2. all six playback-bar buttons are clickable (not disabled) and dispatch the documented `control`
//      actions, which the host forwards verbatim to its stdout (`{"t":"control",...}` = plugin stdin),
//   3. the queue panel lists every item, marks the current one, closes on ESC while the window survives,
//   4. the progress track dispatches a `seek` whose positionMs is ~half of durationMs.
//
// Usage: node packaging/tools/verify-playback-controls.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES } from '../../poc/webview/shared/demoData.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = join(ROOT, 'packaging');
const OUT = join(PKG, 'out');
mkdirSync(OUT, { recursive: true });

const exe = join(PKG, 'native', 'spw-folia-host.exe');
for (const p of [exe, join(PKG, 'web', 'index.html'), join(PKG, 'web', 'settings', 'settings-ui.js')]) {
  if (!existsSync(p)) { console.error(`missing packaged file: ${p}\nrun: bash packaging/build-package.sh`); process.exit(2); }
}
const settings = JSON.parse(readFileSync(join(PKG, 'testdata', 'default-settings.json'), 'utf8'));
if (typeof settings.smartBeat === 'boolean') settings.smartBeat = { enabled: settings.smartBeat, effects: {} };

const LOOP_SECONDS = 16;
const DURATION_MS = LOOP_SECONDS * 1000;
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
const items = [
  { id: 'q1', title: 'Two to Tango 交缠舞步', artist: 'ARTIST-1', album: 'ALBUM-1' },
  { id: 'q2', title: 'Queue Track 2', artist: 'ARTIST-2', album: 'ALBUM-2' },
  { id: 'q3', title: 'Queue Track 3', artist: 'ARTIST-3', album: 'ALBUM-3' },
  { id: 'q4', title: 'Queue Track 4', artist: 'ARTIST-4', album: 'ALBUM-4' },
  { id: 'q5', title: 'Queue Track 5', artist: 'ARTIST-5', album: 'ALBUM-5' },
  { id: 'q6', title: 'Queue Track 6', artist: 'ARTIST-6', album: 'ALBUM-6' },
];
const queue = { mode: 'circle', random: false, index: 0, items };
const track = { id: items[0].id, title: items[0].title, artist: 'WEBVIEW-SPIKE', album: 'Spike Album', durationMs: DURATION_MS };

const args = [
  '--bundle', join(PKG, 'web'),
  '--settings-dir', join(PKG, 'web', 'settings'),
  '--settings-entry', 'settings-ui.js',
  '--window', '1600x900',
  '--user-data-dir', join(OUT, 'webview2-userdata-controls'),
  '--fps-log', join(OUT, 'control-fps.log'),
];

const report = {
  startedAt: new Date().toISOString(), exe, args, ready: null, closed: null, controls: [], queuePosts: 0,
  probes: {}, evalResults: [], screenshots: [], consoleErrors: 0, hostLogLines: [], checks: {}, pass: false,
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
    if (t === 'ready') { report.ready = { ...msg, atMs: Date.now() - t0 }; startFlow(); }
    else if (t === 'closed') report.closed = msg;
    else if (t === 'fps') fps.push({ fps: msg.fps, heapMB: msg.heapMB, atMs: Date.now() - t0 });
    else if (t === 'eval-result') report.evalResults.push(msg.value);
    else if (t === 'queue') report.queuePosts++;
    else if (t === 'control') report.controls.push({ atMs: Date.now() - t0, ...msg });
    else if (t === 'log') {
      const s = String(msg.msg || '');
      if (msg.level === 'error' || s.includes('console-error') || s.includes('js-error') || s.includes('js-rejection')) report.consoleErrors++;
      if (report.hostLogLines.length < 400) report.hostLogLines.push(line);
    }
  }
});

const evalJs = (script) => send({ t: 'command', command: 'eval', script });
const shot = (name) => send({ t: 'command', command: 'screenshot', path: join(OUT, name) });

function startFlow() {
  if (flowStarted) return;
  flowStarted = true;
  report.timing = { spawnToReadyMs: report.ready.atMs };
  send({ t: 'hello', protocol: 1, pluginVersion: 'verify-playback-controls', spwVersion: '1.19.0' });
  send({ t: 'settings', settings });
  send({ t: 'lyrics', ...lyrics });
  send({ t: 'track', ...track });
  send({ t: 'queue', ...queue });
  const anchor = Date.now();
  stateTimer = setInterval(() => {
    send({ t: 'state', posMs: Math.round((Date.now() - anchor) % DURATION_MS), durationMs: DURATION_MS, playing: true, rate: 1, tsMs: Date.now() });
  }, 100);

  const el = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
  // Expand the HUD with a synthetic pointerenter, then report the DOM state of the buttons.
  const probeButtons = `(() => {
    const root = ${el('.spw-playback')};
    // v0.3.0 pointer-idle auto-hide: synthetic hover must also count as pointer activity.
    try { window.dispatchEvent(new PointerEvent('pointermove')); } catch (e) {}
    if (root) { try { root.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); } catch (e) {} }
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((n) => ({ label: n.getAttribute('aria-label'), disabled: !!n.disabled, active: n.getAttribute('data-active'), expanded: n.getAttribute('aria-expanded') }));
    return JSON.stringify({
      bar: !!root,
      expanded: root && root.getAttribute('data-expanded'),
      play: pick('.spw-playback-play'),
      steps: pick('.spw-playback-step'),
      icons: pick('.spw-playback-icon'),
      queuePanel: !!${el('.spw-queue-panel')},
    });
  })()`;

  setTimeout(() => evalJs(probeButtons), 3200);                             // buttons rendered (no overlay)
  setTimeout(() => evalJs(`${el('.spw-playback-play')} && ${el('.spw-playback-play')}.click(); JSON.stringify({clicked:'play'})`), 3700);
  setTimeout(() => evalJs(`(() => { const b = ${el('.spw-playback-step')}; if (b) b.click(); return JSON.stringify({clicked:'previous'}); })()`), 4200);
  setTimeout(() => evalJs(`(() => { const b = document.querySelectorAll('.spw-playback-step')[1]; if (b) b.click(); return JSON.stringify({clicked:'next'}); })()`), 4700);
  setTimeout(() => evalJs(`(() => { const b = ${el('.spw-playback-icon[aria-label="随机播放"]')}; if (b) b.click(); return JSON.stringify({clicked:'shuffle'}); })()`), 5200);
  setTimeout(() => evalJs(`(() => { try { window.dispatchEvent(new PointerEvent('pointermove')); } catch (e) {} const b = ${el('.spw-playback-icon[aria-label="播放列表"]')}; if (b) b.click(); return JSON.stringify({clicked:'queue'}); })()`), 5700);
  setTimeout(() => evalJs(`(() => {
    const panel = ${el('.spw-queue-panel')};
    const rows = panel ? Array.from(panel.querySelectorAll('[data-queue-index]')) : [];
    if (rows.length > 2) rows[2].click();
    return JSON.stringify({ panel: !!panel, rows: rows.length, current: panel ? panel.querySelectorAll('[data-current="true"]').length : 0 });
  })()`), 6300);
  setTimeout(() => shot('packaged-controls-queue.png'), 6800);
  setTimeout(() => evalJs(`(() => {
    const tracks = document.querySelectorAll('.spw-playback-bar .spw-playback-track');
    const track = tracks[tracks.length - 1];
    if (!track) return JSON.stringify({ seek: 'no-track' });
    const r = track.getBoundingClientRect();
    const x = r.left + r.width * 0.5, y = r.top + r.height * 0.5;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 };
    try { track.dispatchEvent(new PointerEvent('pointerdown', opts)); track.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
    track.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return JSON.stringify({ seek: 'dispatched', at: x - r.left, width: r.width });
  })()`), 7300);
  // The seek click landed outside the panel, so the panel closed via its outside-click handler.
  // Re-open it and verify that ESC closes ONLY the panel (the host window must survive: the panel
  // captures ESC and stops propagation, so Shim never forwards it as a host close key).
  setTimeout(() => evalJs(`(() => { try { window.dispatchEvent(new PointerEvent('pointermove')); } catch (e) {} const b = ${el('.spw-playback-icon[aria-label="播放列表"]')}; if (b) b.click(); return JSON.stringify({ reopened: !!${el('.spw-queue-panel')} }); })()`), 7700);
  setTimeout(() => evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); JSON.stringify({esc:'dispatched'})`), 8100);
  setTimeout(() => evalJs(`(() => { const panel = ${el('.spw-queue-panel')}; return JSON.stringify({ panelAfterEsc: !!panel, alive: true }); })()`), 8500);
  setTimeout(() => shot('packaged-controls-bar.png'), 8900);
  setTimeout(() => { send({ t: 'quit' }); }, 10300);
}

child.on('exit', (code) => {
  clearInterval(stateTimer);
  report.exitCode = code;
  report.stderr = stderrChunks.join('');
  const nums = fps.map((f) => f.fps);
  report.fps = { samples: nums.length, median: nums.length ? median(nums) : 0, heapMaxMB: Math.max(0, ...fps.map((f) => f.heapMB || 0)) };
  const vals = report.evalResults.map(unwrap);
  const btnProbe = obj(vals[0]) || {};
  const controls = report.controls;
  const has = (action) => controls.some((c) => c.action === action);
  const seek = controls.find((c) => c.action === 'seek');
  const queuePlay = controls.find((c) => c.action === 'queue-play');
  const allDisabled = (btnProbe.play || []).some((b) => b.disabled) && (btnProbe.icons || []).some((b) => b.disabled);
  report.checks = {
    exitedZero: code === 0,
    barRendered: !!btnProbe.bar,
    buttonsEnabled: !!(btnProbe.play && btnProbe.play.length && !btnProbe.play[0].disabled && (btnProbe.steps || []).every((b) => !b.disabled) && (btnProbe.icons || []).every((b) => !b.disabled)),
    toggleForwarded: has('toggle'),
    previousForwarded: has('previous'),
    nextForwarded: has('next'),
    shuffleForwarded: has('shuffle'),
    seekForwarded: !!seek,
    seekNearHalf: !!(seek && typeof seek.positionMs === 'number' && seek.positionMs >= DURATION_MS * 0.35 && seek.positionMs <= DURATION_MS * 0.65),
    queuePanelRendered: !!(obj(vals[6]) && obj(vals[6]).panel),
    queuePanelRows: !!(obj(vals[6]) && obj(vals[6]).rows >= 6),
    currentHighlighted: !!(obj(vals[6]) && obj(vals[6]).current >= 1),
    queuePlayForwarded: !!queuePlay && queuePlay.index === 2 && queuePlay.random === false,
    escClosedPanelOnly: !!(obj(vals[10]) && obj(vals[10]).panelAfterEsc === false && obj(vals[10]).alive === true),
    noConsoleErrors: report.consoleErrors === 0,
  };
  report.screenshots = ['packaged-controls-queue.png', 'packaged-controls-bar.png'].map((n) => {
    const path = join(OUT, n);
    let bytes = 0;
    try { bytes = readFileSync(path).length; } catch { bytes = 0; }
    return { name: n, path, bytes };
  });
  report.screenshotsPresent = report.screenshots.every((s) => s.bytes > 10000);
  const c = report.checks;
  report.pass = Object.keys(c).every((k) => c[k] === true) && report.screenshotsPresent;
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, 'verify-playback-controls-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    pass: report.pass, checks: c, exitCode: code, controls: report.controls, buttons: btnProbe,
    timing: report.timing, fps: report.fps, screenshots: report.screenshots.map((s) => `${s.name}:${s.bytes}`), stderr: report.stderr.slice(0, 300),
  }, null, 2));
  process.exit(report.pass ? 0 : 1);
});

setTimeout(() => { report.timedOut = true; try { child.kill(); } catch { /* ignore */ } }, 16000).unref();

function unwrap(x) {
  for (let i = 0; i < 4 && typeof x === 'string'; i++) {
    try { x = JSON.parse(x); } catch { break; }
  }
  return x;
}
function obj(v) { return v && typeof v === 'object' ? v : null; }
function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return +(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2).toFixed(1);
}
