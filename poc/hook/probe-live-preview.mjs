#!/usr/bin/env node
// Live-preview probe (docs/live-preview-iframe.md §验收).
//
// Proves the settings-page big preview is Folia's real animated renderer running in the same-origin
// `preview.html` iframe, that its child shim receives the parent config and synthesizes a moving
// clock, and that pause/resume freeze/advance the rendered picture:
//   S1/S2  playing, screenshots 1200 ms apart            -> frame diff > 0
//   S3/S4  after pause, screenshots 1200 ms apart        -> frame diff ~ 0
//   S5     after resume, screenshot 1200 ms after S4     -> frame diff > 0
//
// Two modes:
//   default      drives the real settings overlay (needs task-15 LivePreview mounted): waits for
//                `[data-spw-live-preview] iframe` and clicks the overlay's pause/play button.
//   --self-test  task-14 shim verification without settings-ui: injects the same iframe into the
//                page, posts config/meta/paused directly from the top window and pauses via a
//                `paused:true` message (no settings-ui dependency).
//
// Usage: node poc/hook/probe-live-preview.mjs [--self-test] [--out tmp-verify/live-preview]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const exe = resolve(root, 'poc/webview/host/build/spw-folia-host.exe');
const bundle = resolve(root, 'packaging/web');
const argv = process.argv.slice(2);
const selfTest = argv.includes('--self-test');
const outDir = argv.includes('--out') ? resolve(root, argv[argv.indexOf('--out') + 1]) : resolve(root, 'tmp-verify/live-preview');
mkdirSync(outDir, { recursive: true });

// pngjs lives in the web-spike's probe workspace; load it by absolute path so this script has no
// package.json of its own (poc/hook is a scratch directory). createRequire needs a *file* path:
// it resolves node_modules from that file's directory.
const requireFromServer = createRequire(resolve(root, 'poc/webview/server/package.json'));
const { PNG } = requireFromServer('pngjs');

const settings = JSON.parse(readFileSync(resolve(root, 'packaging/testdata/default-settings.json'), 'utf8'));
const LINES = [
  { startMs: 0, endMs: 4200, main: 'プレビュー', sub: 'live preview', cells: [{ startMs: 0, endMs: 2100, text: 'プレ' }, { startMs: 2100, endMs: 4200, text: 'ビュー' }] },
  { startMs: 4200, endMs: 8400, main: '光が満ちて', sub: 'light overflows', cells: [{ startMs: 4200, endMs: 6300, text: '光が' }, { startMs: 6300, endMs: 8400, text: '満ちて' }] },
  { startMs: 8400, endMs: 12600, main: '君の声が', sub: 'your voice', cells: [{ startMs: 8400, endMs: 10500, text: '君の' }, { startMs: 10500, endMs: 12600, text: '声が' }] },
  { startMs: 12600, endMs: 16800, main: '向远方回响', sub: 'echoes far away', cells: [{ startMs: 12600, endMs: 14700, text: '向远方' }, { startMs: 14700, endMs: 16800, text: '回响' }] },
];

const shot = (name) => resolve(outDir, name);
const report = {
  probe: 'live-preview', mode: selfTest ? 'self-test' : 'settings-ui', startedAt: new Date().toISOString(),
  shots: {}, evals: [], frameDiffs: {}, checks: {}, pass: false,
};
const log = [];
// Fresh WebView2 profile per run: a stale profile can carry an old Folia PWA Service Worker that
// intercepts the /preview.html navigation and serves a cached legacy index.html (no preview shim).
// The host also purges SW/caches from the page (Shim.js), but a clean profile keeps runs deterministic.
const profileDir = resolve(outDir, '_webview2-profile');
try { rmSync(profileDir, { recursive: true, force: true }); } catch { }
const child = spawn(exe, [
  '--bundle', bundle, '--window', '1600x1000', '--force-dsf', '1', '--bundle-version', '0.1.5-probe',
  '--settings-dir', resolve(bundle, 'settings'), '--settings-entry', 'settings-ui.js',
  '--user-data-dir', profileDir,
], { cwd: root, windowsHide: false });
child.stdin.on('error', () => { /* host closes stdin during shutdown */ });
const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* closed */ } };
const evalJs = (script) => send({ t: 'command', command: 'eval', script });

const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  log.push(line);
  if (line.includes('"t":"eval-result"')) {
    try { report.evals.push(JSON.parse(line)); } catch { /* keep raw in log */ }
  }
});

const readyPromise = new Promise((resolveReady) => {
  rl.on('line', (line) => { if (line.includes('"t":"ready"')) resolveReady(); });
});
const exited = new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code)));

// Eval results arrive as JSON-encoded strings; unwrap until a plain value remains.
function unwrapEval(entry) {
  let value = entry && entry.value;
  for (let i = 0; i < 4 && typeof value === 'string'; i++) {
    try { value = JSON.parse(value); } catch { break; }
  }
  return value;
}
async function evalValue(script, waitMs = 400) {
  const before = report.evals.length;
  evalJs(script);
  const deadline = Date.now() + waitMs + 4000;
  while (Date.now() < deadline) {
    if (report.evals.length > before) return unwrapEval(report.evals[report.evals.length - 1]);
    await delay(80);
  }
  return null;
}

// Pixel diff inside a crop box (physical screenshot pixels), sampling every 2nd pixel.
// Two ratios are reported: `ratio` counts any pixel above the classic threshold (d>24, catches grain
// noise) and `strongRatio` only pixels with a strong change (d>90) - the latter is what distinguishes
// real motion from Folia's clock-independent grain/dither shimmer while paused.
function diffPng(aPath, bPath, crop) {
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  if (a.width !== b.width || a.height !== b.height) return { error: `size ${a.width}x${a.height} vs ${b.width}x${b.height}`, ratio: 1, strongRatio: 1 };
  const x0 = Math.max(0, Math.min(crop.x0, a.width - 1));
  const y0 = Math.max(0, Math.min(crop.y0, a.height - 1));
  const x1 = Math.max(x0 + 1, Math.min(crop.x1, a.width));
  const y1 = Math.max(y0 + 1, Math.min(crop.y1, a.height));
  let sampled = 0, changed = 0, strong = 0, sum = 0;
  // 8x8 block means: averages out Folia's per-pixel grain/dither noise, keeps real spatial motion.
  let blocks = 0, movedBlocks = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const ia = (a.width * y + x) << 2;
      const d = Math.abs(a.data[ia] - b.data[ia]) + Math.abs(a.data[ia + 1] - b.data[ia + 1]) + Math.abs(a.data[ia + 2] - b.data[ia + 2]);
      sum += d;
      if (d > 24) changed++;
      if (d > 90) strong++;
      sampled++;
    }
  }
  for (let by = y0; by + 8 <= y1; by += 8) {
    for (let bx = x0; bx + 8 <= x1; bx += 8) {
      let s2 = 0, n2 = 0;
      for (let yy = by; yy < by + 8; yy += 2) {
        for (let xx = bx; xx < bx + 8; xx += 2) {
          const ia = (a.width * yy + xx) << 2;
          s2 += Math.abs(a.data[ia] - b.data[ia]) + Math.abs(a.data[ia + 1] - b.data[ia + 1]) + Math.abs(a.data[ia + 2] - b.data[ia + 2]);
          n2++;
        }
      }
      blocks++;
      if (n2 && (s2 / n2) > 12) movedBlocks++;
    }
  }
  return {
    ratio: sampled ? changed / sampled : 0,
    strongRatio: sampled ? strong / sampled : 0,
    blockRatio: blocks ? movedBlocks / blocks : 0,
    changedPixels: changed, strongPixels: strong, blocks, movedBlocks, sampled,
    meanAbsDiff: sampled ? sum / sampled : 0,
    crop: { x0, y0, x1, y1 },
  };
}

// Reads the child shim's synthesized clock. Pause must pin clockMs (frozen timeline); resume must
// advance it. This is the hard pause criterion - pixel diffs also contain Folia's clock-independent
// grain/dither noise, so they are only a secondary, relative check.
const CLOCK_SCRIPT = `(function(){
  try {
    var f = window.__SPW_SELFTEST_FRAME__ || document.querySelector('[data-spw-live-preview] iframe') || document.querySelector('iframe[src*="preview.html"]');
    if (!f) return JSON.stringify({ ok:false, reason:'no-iframe' });
    var w = f.contentWindow, s = w && w.__SPW_FOLIA_PREVIEW__;
    if (!s) return JSON.stringify({ ok:false, reason:'no-preview-shim' });
    return JSON.stringify({ ok:true, clockMs: s.clockMs, paused: !!s.paused, playerState: s.playerState || null, frames: s.frames });
  } catch (e) { return JSON.stringify({ ok:false, reason:'exception', message:String(e && e.message || e) }); }
})()`;

const SHAKE_SCRIPT = `(function(){
  try {
    // Self-test mode injects its own frame; prefer it, otherwise use the settings-UI LivePreview
    // iframe (task-15). Querying generically first would read the real overlay's preview while the
    // probe drives its injected frame -> misleading "pause does not freeze" results.
    var f = window.__SPW_SELFTEST_FRAME__ || document.querySelector('[data-spw-live-preview] iframe') || document.querySelector('iframe[src*="preview.html"]');
    if (!f) return JSON.stringify({ ok:false, reason:'no-iframe' });
    var d = f.contentDocument, w = f.contentWindow;
    var s = w && w.__SPW_FOLIA_PREVIEW__ ? w.__SPW_FOLIA_PREVIEW__ : null;
    var r = f.getBoundingClientRect();
    var resources = [];
    try { resources = (w.performance.getEntriesByType('resource') || []).map(function(e){return e.name;}).filter(function(n){return /preview|_host|assets\\//.test(n);}).slice(-12); } catch (e2) { }
    return JSON.stringify({
      ok:true, canvases: d ? d.querySelectorAll('canvas').length : -1,
      receivedConfig: !!(s && s.receivedConfig), frames: s ? s.frames : -1,
      paused: s ? s.paused : null, uv: window.devicePixelRatio,
      readyState: d ? d.readyState : null,
      href: w && w.location ? String(w.location.href) : null,
      title: d ? d.title : null,
      bodyLen: d && d.body ? d.body.innerHTML.length : -1,
      shimPresent: !!(w && w.__SPW_FOLIA_PREVIEW_SHIM__),
      scripts: d ? Array.prototype.map.call(d.scripts, function (s) { return s.src || s.textContent.slice(0, 40); }) : null,
      resources: resources,
      rect: { x:r.left, y:r.top, w:r.width, h:r.height },
      clipRect: (function(){ var el = f.parentElement && f.parentElement.closest ? f.parentElement.closest('[data-spw-live-preview]') : null; if (!el) return null; var rr = el.getBoundingClientRect(); return { x:rr.left, y:rr.top, w:rr.width, h:rr.height }; })(),
      iframeSrc: f.getAttribute('src') || ''
    });
  } catch (e) { return JSON.stringify({ ok:false, reason:'exception', message:String(e && e.message || e) }); }
})()`;

const pauseClick = `(function(){
  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
  var target = btns.filter(function(b){ return /暂停预览|继续预览|恢复预览|pause preview|resume preview/i.test(b.getAttribute('aria-label')||''); })[0];
  if (!target) return 'no-button:' + btns.map(function(b){return b.getAttribute('aria-label')||'';}).join('|');
  target.click();
  return 'clicked:' + (target.getAttribute('aria-label')||'');
})()`;

// Self-test iframe injection: same geometry/layout the settings overlay is specified to use
// (iframe fixed at 1920x1080 CSS px, CSS-scaled with 1.15 sample zoom), but posted config directly.
const injectSelfTestIframe = `(function(){
  if (window.__SPW_SELFTEST_FRAME__) return 'already';
  var wrap = document.createElement('div');
  wrap.setAttribute('data-spw-live-preview', 'self-test');
  // Self-test wrapper must sit ABOVE the settings overlay (z 2147483000): otherwise the overlay's own
  // live preview (still playing) covers the injected frame inside the diff crop.
  wrap.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;overflow:hidden;z-index:2147483600;background:#000';
  var f = document.createElement('iframe');
  f.setAttribute('src', '/preview.html?obs=1&preview=1');
  f.style.cssText = 'position:absolute;left:50%;top:50%;width:1920px;height:1080px;border:0;transform:translate(-50%,-50%) scale(0.72)';
  wrap.appendChild(f);
  document.body.appendChild(wrap);
  window.__SPW_SELFTEST_FRAME__ = f;
  window.__SPW_PROBE_MSGS__ = [];
  window.addEventListener('message', function(e){ if (e.data && e.data.__spwFoliaPreview === 1 && e.data.source === 'preview') window.__SPW_PROBE_MSGS__.push(e.data); });
  return 'injected';
})()`;

const sendConfigScript = (configJson, paused) => `(function(){
  var f = window.__SPW_SELFTEST_FRAME__;
  if (!f || !f.contentWindow) return 'no-frame';
  var msg = function(kind, payload){ f.contentWindow.postMessage({ __spwFoliaPreview: 1, kind: kind, payload: payload }, '*'); };
  msg('config', ${configJson});
  msg('meta', { loopDuration: 14.4, startOffset: 0 });
  msg('paused', ${paused ? 'true' : 'false'});
  return 'sent';
})()`;

const start = async () => {
  await Promise.race([readyPromise, delay(15000)]);
  send({ t: 'hello', protocol: 1, pluginVersion: '0.1.5', spwVersion: '1.19.0' });
  send({ t: 'settings', settings });
  send({ t: 'lyrics', lines: LINES, offsetMs: 0 });
  send({ t: 'track', id: 'probe-live', title: '预览探针', artist: 'probe', album: 'probe', durationMs: 16800 });
  const pump = setInterval(() => {
    send({ t: 'state', posMs: 500 + Date.now() % 15000, durationMs: 16800, playing: true, rate: 1, tsMs: Date.now() });
  }, 100);

  send({ t: 'command', command: 'open-settings' });
  await delay(3000); // overlay mounts + paints

  if (selfTest) {
    // A minimal ObsBrowserSourceConfig built by the web-spike from its demo fixture (the production
    // config is built by the settings-ui publisher; this only exercises the child shim).
    const { CONFIG } = await import('../../poc/webview/shared/demoData.mjs');
    const configJson = JSON.stringify(CONFIG);
    const injected = await evalValue(injectSelfTestIframe);
    report.selfTestInjected = injected;
    await delay(700);
    for (let i = 0; i < 4; i++) {
      const sent = await evalValue(sendConfigScript(configJson, false));
      if (i === 0) report.selfTestConfigSent = sent;
      await delay(900);
    }
  }

  // Wait for the iframe's renderer (lazy chunks) and config reception.
  let pre = null;
  for (let i = 0; i < 25; i++) {
    pre = await evalValue(SHAKE_SCRIPT);
    if (pre && pre.ok && pre.receivedConfig && pre.canvases > 0) break;
    await delay(500);
  }
  report.checks.iframePresent = !!(pre && pre.ok);
  report.checks.iframeCanvases = !!(pre && pre.canvases > 0);
  report.checks.receivedConfig = !!(pre && pre.receivedConfig);
  report.iframeState = pre;

  await delay(600);
  send({ t: 'command', command: 'screenshot', path: shot('s1-playing.png') });
  await delay(1200);
  send({ t: 'command', command: 'screenshot', path: shot('s2-playing.png') });
  await delay(500);

  // Pause: real settings overlay button when present, child message in self-test mode.
  report.playingClock = await evalValue(CLOCK_SCRIPT);
  if (selfTest) {
    const { CONFIG } = await import('../../poc/webview/shared/demoData.mjs');
    await evalValue(sendConfigScript(JSON.stringify(CONFIG), true));
  } else {
    report.pauseClick = await evalValue(pauseClick);
  }
  await delay(700);
  send({ t: 'command', command: 'screenshot', path: shot('s3-paused.png') });
  await delay(1200);
  send({ t: 'command', command: 'screenshot', path: shot('s4-paused.png') });
  await delay(400);
  report.pausedState = await evalValue(SHAKE_SCRIPT);
  // Hard pause criterion: the child clock must stay pinned while paused (two samples 800 ms apart).
  report.pausedClock1 = await evalValue(CLOCK_SCRIPT);
  await delay(800);
  report.pausedClock2 = await evalValue(CLOCK_SCRIPT);
  report.pausedClockDeltaMs = (report.pausedClock1 && report.pausedClock2 &&
    typeof report.pausedClock1.clockMs === 'number' && typeof report.pausedClock2.clockMs === 'number')
    ? Math.abs(report.pausedClock2.clockMs - report.pausedClock1.clockMs) : null;

  if (selfTest) {
    const { CONFIG } = await import('../../poc/webview/shared/demoData.mjs');
    await evalValue(sendConfigScript(JSON.stringify(CONFIG), false));
  } else {
    report.resumeClick = await evalValue(pauseClick);
  }
  await delay(1200);
  send({ t: 'command', command: 'screenshot', path: shot('s5-resumed.png') });
  await delay(400);
  report.resumedState = await evalValue(SHAKE_SCRIPT);
  report.resumedClock1 = await evalValue(CLOCK_SCRIPT);
  await delay(500);
  report.resumedClock2 = await evalValue(CLOCK_SCRIPT);
  // Two resumed samples 500 ms apart: the advance must be measured after resume, not against the
  // paused clock (a cold iframe can receive its first config while already paused, so the frozen
  // clock legitimately sits near 0 and a paused->resumed delta would be tiny/flaky).
  report.resumedClockDeltaMs = (report.resumedClock2 && report.resumedClock1 &&
    typeof report.resumedClock2.clockMs === 'number' && typeof report.resumedClock1.clockMs === 'number')
    ? report.resumedClock2.clockMs - report.resumedClock1.clockMs : null;
  report.resumedFromPausedDeltaMs = (report.resumedClock1 && report.pausedClock2 &&
    typeof report.resumedClock1.clockMs === 'number' && typeof report.pausedClock2.clockMs === 'number')
    ? report.resumedClock1.clockMs - report.pausedClock2.clockMs : null;
  report.resumedClock = report.resumedClock2;
  report.messages = await evalValue(`JSON.stringify({messages:(window.__SPW_PROBE_MSGS__||[]).map(function(m){return m.kind+(m.payload&&m.payload.canvases!==undefined?':'+m.payload.canvases:'')})})`);

  // Crop the diff to the iframe rectangle so chrome/overlay animation cannot mask a frozen renderer.
  // Screenshot pixels may be larger than the 1600x1000 CSS window (device scaling); scale rects by
  // png.width / window CSS width, which the probe fixes with --force-dsf 1.
  let shotScale = 1;
  try {
    const probePng = PNG.sync.read(readFileSync(shot('s2-playing.png')));
    shotScale = probePng.width / 1600;
    report.screenshot = { width: probePng.width, height: probePng.height, cssWindow: '1600x1000', scale: shotScale };
  } catch { /* keep 1 */ }
  const rectOf = (st) => {
    if (!st || !st.rect) return null;
    const r = { x: st.rect.x, y: st.rect.y, w: st.rect.w, h: st.rect.h };
    const c = st.clipRect;
    if (c && c.w > 0 && c.h > 0) {
      const ix0 = Math.max(r.x, c.x), iy0 = Math.max(r.y, c.y);
      const ix1 = Math.min(r.x + r.w, c.x + c.w), iy1 = Math.min(r.y + r.h, c.y + c.h);
      if (ix1 > ix0 && iy1 > iy0) return { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 };
    }
    return r;
  };
  const cropFor = (st) => {
    const r = rectOf(st) || { x: 0, y: 0, w: 1600, h: 1000 };
    const s = shotScale || 1;
    const x0 = Math.round(r.x * s), y0 = Math.round(r.y * s);
    return { x0, y0, x1: x0 + Math.round(r.w * s), y1: y0 + Math.round(r.h * s) };
  };
  const crop = cropFor(pre);
  report.cropRect = crop;
  report.rects = {
    iframe: pre && pre.rect ? pre.rect : null,
    wrapper: pre && pre.clipRect ? pre.clipRect : null,
    visible: rectOf(pre),
    crop,
    scale: shotScale,
  };
  report.frameDiffs.playing = diffPng(shot('s1-playing.png'), shot('s2-playing.png'), crop);
  report.frameDiffs.paused = diffPng(shot('s3-paused.png'), shot('s4-paused.png'), crop);
  report.frameDiffs.resumed = diffPng(shot('s4-paused.png'), shot('s5-resumed.png'), crop);

  // Hard pause criterion (clock): the child shim's synthesized timeline must be pinned while paused and
  // advance again after resume. Pixel diffs keep Folia's clock-independent grain/dither noise, so the
  // pixel check below is relative ("strong" pixels, paused < 35% of playing) and informational only.
  // Pixel check: crop is wrapper∩iframe (settings dim overlay / main visualizer excluded) and the
  // child's rAF gate freezes grain too, so the raw paused ratio should be ~0. Keep the relative
  // block criterion as a fallback for machines where a stray repaint still lands in the crop.
  const pausedRatio = report.frameDiffs.paused.ratio;
  const playingRatio = report.frameDiffs.playing.ratio;
  report.checks.iframeTitle = !!(pre && pre.title === 'Folia OBS');
  report.checks.pausedClockFrozen = typeof report.pausedClockDeltaMs === 'number' && report.pausedClockDeltaMs < 10;
  report.checks.pausedPlayerStatePaused = !!(report.pausedClock2 && report.pausedClock2.paused === true);
  report.checks.resumedClockAdvances = (typeof report.resumedClockDeltaMs === 'number' && report.resumedClockDeltaMs > 300)
    || (typeof report.resumedFromPausedDeltaMs === 'number' && report.resumedFromPausedDeltaMs > 300);
  report.checks.playingMoves = playingRatio > 0.002;
  report.checks.pausedFreezes = (pausedRatio < 0.01 && report.frameDiffs.playing.ratio > 0.002) ||
    report.frameDiffs.paused.blockRatio < report.frameDiffs.playing.blockRatio * 0.15;
  report.checks.resumeMoves = report.frameDiffs.resumed.ratio > 0.002;
  report.checks.noPageErrors = !log.some((l) => l.includes('"level":"error"'));
  report.frameDiffNote = 'crop = wrapper[data-spw-live-preview] ∩ iframe rect（排除设置窗 dim 遮罩与遮罩下仍在播放的主 visualizer）；' +
    '子帧 PreviewShim 在 document_start 装了 rAF gate（暂停时冻结 Folia 渲染器自身 rAF 循环，含 grain/dither），恢复时 flush 队列；' +
    '像素判据 paused.ratio < 0.01（或 blockRatio < playing.blockRatio*0.15），暂停硬判据为子帧合成 clock 冻结 pausedClockDeltaMs<10ms。';
  report.pass = Object.values(report.checks).every(Boolean);

  clearInterval(pump);
  send({ t: 'quit' });
  const code = await Promise.race([exited, delay(6000)]);
  report.exitCode = code;
  writeFileSync(resolve(outDir, 'host-log.jsonl'), log.join('\n') + '\n');
  writeFileSync(shot('probe-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    out: outDir, mode: report.mode, exitCode: code, pass: report.pass,
    checks: report.checks, frameDiffs: report.frameDiffs,
    iframeState: report.iframeState, pausedState: report.pausedState, resumedState: report.resumedState,
  }, null, 1));
};

start().catch((error) => {
  writeFileSync(shot('probe-report.json'), JSON.stringify({ ...report, error: String(error) }, null, 2) + '\n');
  try { child.kill(); } catch { /* ignore */ }
  console.error(error);
  process.exitCode = 1;
});
setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 90000);
