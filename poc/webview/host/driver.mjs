#!/usr/bin/env node
// Protocol-v1 driver for spw-folia-host.exe: spawns the host exactly like the Kotlin plugin will,
// speaks JSON lines over stdin/stdout (docs/protocol.md §1/§2), streams a synthetic 16 s lyric
// timeline at 100 ms, takes screenshots at two different clock positions, then tests the ESC path
// (page keydown -> shim -> host -> closed+exit 0) and writes a machine-readable report.
//
// Usage: node driver.mjs [--fullscreen] [--window 1600x900] [--force-dsf N] [--dev-url URL]
//                        [--duration 14500] [--out out/]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { CONFIG, LINES, LOOP_SECONDS } from '../shared/demoData.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const exe = join(here, 'build', 'spw-folia-host.exe');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

if (!existsSync(exe)) {
  console.error(`host exe not built: ${exe} (run bash build.sh)`);
  process.exit(2);
}

const outDir = resolve(here, opt('out', 'out'));
mkdirSync(outDir, { recursive: true });
const shots = [
  { atMs: 3200, name: 'driver-pos-1.png', posMs: 1000 },
  { atMs: 8200, name: 'driver-pos-2.png', posMs: 8600 },
  { atMs: 12200, name: 'driver-pos-3.png', posMs: 12500 },
];

// protocol §1 lyrics lines: [{startMs,endMs,main,sub,cells:[{startMs,endMs,text}]}]
const lyricLines = LINES.map((line) => ({
  startMs: Math.round(line.startTime * 1000),
  endMs: Math.round(line.endTime * 1000),
  main: line.fullText,
  sub: line.translation ?? '',
  cells: line.words.map((w) => ({ startMs: Math.round(w.startTime * 1000), endMs: Math.round(w.endTime * 1000), text: w.text })),
}));

const args = [
  '--bundle', resolve(repoRoot, 'poc/webview/dist/dist'),
  '--demo',
  '--no-overlay',
  '--fps-log', join(outDir, 'driver-fps.log'),
  '--user-data', join(outDir, 'webview2-userdata'),
];
if (flag('fullscreen')) args.push('--fullscreen');
else args.push('--window', opt('window', '1600x900'));
if (opt('force-dsf')) args.push('--force-dsf', opt('force-dsf'));
if (opt('dev-url')) args.push('--dev-url', opt('dev-url'));
if (flag('settings-ui')) {
  args.push('--settings-dir', resolve(repoRoot, 'poc/settings-ui/dist'));
  args.push('--settings-entry', opt('settings-entry', 'settings-ui.js'));
}
const durationMs = Number(opt('duration', '14500'));

rmSync(join(outDir, 'driver-fps.log'), { force: true });
const t0 = Date.now();
const child = spawn(exe, args, { cwd: resolve(repoRoot, 'poc/webview'), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
const report = {
  exe,
  args,
  spawnedAt: new Date().toISOString(),
  ready: null,
  closed: null,
  navMs: null,
  startupMs: null,
  fps: [],
  longFrames: 0,
  heapMBMax: 0,
  evalResults: [],
  screenshots: [],
  stdoutLines: 0,
  stderr: '',
  exitCode: null,
  exitSignal: null,
};
const timings = {};
let modeList = null;

function send(obj) {
  try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* host already gone */ }
}

// stdin EPIPE when the host process exits mid-stream is expected on close paths; swallow it.
child.stdin.on('error', () => {});

const fpsCsv = join(outDir, 'driver-fps.log');
const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  report.stdoutLines++;
  if (!report.stdout) report.stdout = [];
  if (report.stdout.length < 4000) report.stdout.push(line);
  let msg;
  try { msg = JSON.parse(line); } catch { report.stderr += `unparsable stdout: ${line.slice(0, 200)}\n`; return; }
  if (msg.t === 'ready') {
    report.ready = msg;
    report.navMs = msg.startedAtMs ?? null;
    report.startupMs = Date.now() - t0;
    schedule();
  } else if (msg.t === 'closed') report.closed = msg;
  else if (msg.t === 'fps') {
    report.fps.push({ fps: msg.fps, heapMB: msg.heapMB, canvases: msg.canvases, dpr: msg.dpr, w: msg.w, h: msg.h });
    report.longFrames += msg.longFrames || 0;
    report.heapMBMax = Math.max(report.heapMBMax, msg.heapMB || 0);
  } else if (msg.t === 'eval-result') report.evalResults.push(msg.value);
  else if (msg.t === 'screenshot') report.screenshots.push({ path: msg.path ?? msg.msg, bytes: msg.bytes, atMs: msg.atMs });
});
child.stderr.on('data', (chunk) => { report.stderr += chunk.toString(); });

function schedule() {
  // settings: minimal tree; the demo config is embedded host-side (--demo), page-side publisher is
  // not part of this harness yet. Keys follow Folia storage keys (docs/folia-spec/settings-ui.md).
  send({ t: 'settings', settings: { styleId: 'sonnet', smartBeat: true, textureResolution: 1.5, lyricMotion: 0.8 } });
  send({ t: 'lyrics', lines: lyricLines, offsetMs: 0 });
  send({ t: 'track', id: 'spike-song', title: 'Spike Track', artist: 'webview-spike', album: 'Spike', durationMs: LOOP_SECONDS * 1000 });

  const start = Date.now();
  timings.stateTimer = setInterval(() => {
    const elapsed = Date.now() - start;
    const posMs = Math.round(elapsed % (LOOP_SECONDS * 1000));
    const frame = {
      t: 'state',
      posMs,
      durationMs: LOOP_SECONDS * 1000,
      playing: true,
      rate: 1,
      tsMs: Date.now(),
      lyricOffsetMs: 0,
    };
    if (!flag('fullscreen')) timings.lastPos = posMs;
    send(frame);
  }, 100);
  // keep the synthetic audio provider "playing" shape via the host's stdin audio path for the demo
  timings.audioTimer = setInterval(() => {
    const t = Date.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.9);
    const bands = { bass: 90 + 120 * pulse, lowMid: 70 + 90 * pulse, mid: 60 + 100 * Math.abs(Math.sin(t * 1.3)), vocal: 110 + 100 * pulse, treble: 40 + 90 * Math.abs(Math.sin(t * 2.7)) };
    send({ t: 'audio', power: bands.bass * 0.9, ...bands, silent: false, spectrum: synthSpectrum(pulse) });
  }, 16);

  for (const shot of shots) {
    timings[`shot_${shot.name}`] = setTimeout(() => {
      send({ t: 'command', command: 'screenshot', path: join(outDir, shot.name) });
      // NOTE: command screenshots are timestamped by the host; posMs below is for documentation only
      shot.expectedPosMs = shot.posMs;
    }, shot.atMs);
  }
  timings.esc = setTimeout(() => {
    // simulate the user pressing ESC: page keydown -> shim {type:'key'} -> host closes (closed reason user)
    send({
      t: 'command',
      command: 'eval',
      script: "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 'esc-dispatched'",
    });
  }, durationMs);

  // --settings-ui: exercise protocol §3 injection of the real settings bundle (after Shim.js) and
  // the page<->host ui channel: command settings -> host posts {type:'ui',action:'toggle-settings'}.
  if (flag('settings-ui')) {
    timings.settingsEval1 = setTimeout(() => {
      send({
        t: 'command',
        command: 'eval',
        script: "JSON.stringify({api:!!window.__SPW_FOLIA_SETTINGS_UI__,open:(window.__SPW_FOLIA_SETTINGS_UI__||{}).isOpen??null,hasTab:/歌词动画/.test(document.body.innerText),bodyLen:document.body.innerText.length})",
      });
    }, 4200);
    timings.settingsOpen = setTimeout(() => send({ t: 'command', command: 'settings' }), 4700);
    timings.settingsShot = setTimeout(() => send({ t: 'command', command: 'screenshot', path: join(outDir, 'settings-ui-open.png') }), 5900);
    timings.settingsEval2 = setTimeout(() => {
      send({
        t: 'command',
        command: 'eval',
        script: "JSON.stringify({open:(window.__SPW_FOLIA_SETTINGS_UI__||{}).isOpen??null,hasTab:/歌词动画/.test(document.body.innerText),hasStyleGrid:/样式/.test(document.body.innerText),body:document.body.innerText.slice(0,160)})",
      });
    }, 6500);
    timings.settingsClose = setTimeout(() => send({ t: 'command', command: 'close-settings' }), 7000);
  }
  timings.fallbackQuit = setTimeout(() => send({ t: 'quit' }), durationMs + 3000);

  // --modes a,b,c: cycle visualizer styles through the live config channel and screenshot each,
  // producing the "host renders every style" demo set under <out>/host-styles/.
  const modeListLocal = opt('modes') ? opt('modes').split(',').map((s) => s.trim()).filter(Boolean) : null;
  modeList = modeListLocal;
  if (modeList) {
    mkdirSync(join(outDir, 'host-styles'), { recursive: true });
    const startCycle = 1500;
    const step = 1500;
    modeList.forEach((mode, i) => {
      timings[`mode_${mode}`] = setTimeout(() => {
        send({ t: 'config', config: { ...CONFIG, visualizerMode: mode } });
        timings[`shot_${mode}`] = setTimeout(() => {
          send({ t: 'command', command: 'screenshot', path: join(outDir, 'host-styles', `${mode}.png`) });
        }, 850);
      }, startCycle + i * step);
    });
    const endAt = startCycle + modeList.length * step + 1200;
    clearTimeout(timings.esc);
    clearTimeout(timings.fallbackQuit);
    timings.esc = setTimeout(() => {
      send({ t: 'command', command: 'eval', script: "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 'esc-dispatched'" });
    }, endAt);
    timings.fallbackQuit = setTimeout(() => send({ t: 'quit' }), endAt + 5000);
  }
}

function synthSpectrum(pulse) {
  const bins = [];
  for (let i = 0; i < 1024; i++) {
    const low = Math.pow(1 - i / 1024, 1.7);
    bins.push(Math.max(0, Math.min(255, Math.round(30 + 200 * low * (0.4 + 0.6 * pulse) * (0.7 + 0.3 * Math.random())))));
  }
  return bins;
}

child.on('exit', (code, signal) => {
  for (const key of Object.keys(timings)) {
    clearInterval(timings[key]);
    clearTimeout(timings[key]);
  }
  report.hostStyleScreenshots = (modeList || []).map((mode) => {
    const p = join(outDir, 'host-styles', `${mode}.png`);
    return { mode, path: p, exists: existsSync(p), bytes: existsSync(p) ? readFileSync(p).length : 0 };
  });
  report.exitCode = code;
  report.exitSignal = signal;
  report.finishedAt = new Date().toISOString();
  report.fpsSummary = summarize(report.fps);
  report.screenshotChecks = shots.map((s) => ({ name: s.name, path: join(outDir, s.name), exists: existsSync(join(outDir, s.name)), bytes: existsSync(join(outDir, s.name)) ? readFileSync(join(outDir, s.name)).length : 0 }));
  if (flag('settings-ui')) {
    const p = join(outDir, 'settings-ui-open.png');
    report.settingsUi = { shot: p, exists: existsSync(p), bytes: existsSync(p) ? readFileSync(p).length : 0 };
  }
  writeFileSync(join(outDir, 'driver-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ready: report.ready?.t,
    navMs: report.navMs,
    startupMs: report.startupMs,
    closed: report.closed,
    exitCode: report.exitCode,
    fps: report.fpsSummary,
    screenshots: report.screenshotChecks.map((s) => `${s.name}:${s.exists ? s.bytes : 'MISSING'}`),
    eval: report.evalResults,
    stderr: report.stderr.slice(0, 1500),
  }, null, 2));
  process.exit(report.exitCode === 0 && report.closed?.reason === 'user' ? 0 : 1);
});

child.on('error', (err) => {
  console.error('spawn failed:', err);
  process.exit(3);
});

process.on('SIGINT', () => { send({ t: 'quit' }); setTimeout(() => child.kill(), 1500); });

function summarize(samples) {
  if (!samples.length) return null;
  const fps = samples.map((s) => s.fps).filter((v) => typeof v === 'number');
  fps.sort((a, b) => a - b);
  return {
    samples: samples.length,
    fpsMin: fps[0],
    fpsMedian: fps[Math.floor(fps.length / 2)],
    fpsMax: fps[fps.length - 1],
    heapMBMax: report.heapMBMax,
    canvases: samples[samples.length - 1]?.canvases ?? null,
  };
}
