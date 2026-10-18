// Demo driver for spw-folia-host.exe (the native helper spike).
//
// Spawns the helper exactly like the JVM plugin would, feeds it a Folia OBS config + 60 Hz state
// frames over stdin, collects its JSON-lines reports from stdout (WebView2 versions, nav timing,
// FPS samples, screenshot path), grabs a desktop screenshot to prove the real window exists, and
// writes out/host/report.json.
//
//   node run-demo.mjs [--mode sonnet] [--fullscreen] [--duration 10000] [--shot-at 4000]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, LOOP_SECONDS, stateFrame } from '../shared/demoData.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const EXE = path.join(__dirname, 'build', 'spw-folia-host.exe');
const BUNDLE = path.resolve(__dirname, '..', 'dist', 'dist');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const mode = String(opt('mode', 'sonnet'));
const fullscreen = argv.includes('--fullscreen');
const durationMs = Number(opt('duration', 10000));
const shotAtMs = Number(opt('shot-at', 4000));
const tag = `${mode}-${fullscreen ? 'fullscreen' : 'window'}`;
const shotPath = path.join(OUT, `host-${tag}.png`);
const desktopShotPath = path.join(OUT, `desktop-${tag}.png`);

const startedAt = Date.now();
const messages = [];
const fpsSamples = [];
let spawnError = null;

const args = [
  '--bundle', BUNDLE,
  fullscreen ? '--fullscreen' : '--windowed',
  '--fps-log',
  '--screenshot', shotPath,
  '--shot-at', String(shotAtMs),
  '--duration', String(durationMs),
  '--user-data', path.join(OUT, 'webview2-profile'),
  '--title', 'spw-folia-host spike',
];
const child = spawn(EXE, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
child.on('error', e => { spawnError = String(e.message); });

const startNav = { at: null };
let stdoutBuffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  stdoutBuffer += chunk;
  let nl;
  while ((nl = stdoutBuffer.indexOf('\n')) >= 0) {
    const line = stdoutBuffer.slice(0, nl).trim();
    stdoutBuffer = stdoutBuffer.slice(nl + 1);
    if (!line) continue;
    let msg = null;
    try { msg = JSON.parse(line); } catch { messages.push({ raw: line.slice(0, 300), atMs: Date.now() - startedAt }); continue; }
    msg._atMs = Date.now() - startedAt;
    messages.push(msg);
    if (msg.type === 'fps') fpsSamples.push(msg);
    if (msg.type === 'nav-done' && startNav.at === null) startNav.at = msg._atMs;
  }
});
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', d => { stderr += d; });

// --- feed config once stdout shows the page navigated (or right away; host buffers it) ---
const configPayload = JSON.stringify({ type: 'config', config: { ...CONFIG, visualizerMode: mode } });
const feedState = () => {
  const t = ((Date.now() - startedAt) / 1000) % LOOP_SECONDS;
  const frame = stateFrame(t);
  child.stdin.write(JSON.stringify(frame) + '\n');
};

let stateTimer = null;
let t;
const feed = () => {
  try { child.stdin.write(configPayload + '\n'); } catch {}
  t = setInterval(feedState, 16);
  // desktop screenshot proves a real top-level window is on screen (helper's own CapturePreview
  // only sees webview content, not the window frame / compositor result)
  setTimeout(() => {
    const ps = [
      '-NoProfile', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $bmp.Save('${desktopShotPath.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png); "saved ${desktopShotPath}"`,
    ];
    try { execFileSync('pwsh', ps, { timeout: 20000, windowsHide: true }); } catch (e) { messages.push({ raw: 'desktop-screenshot-failed: ' + String(e.message).slice(0, 200) }); }
  }, Math.min(shotAtMs, durationMs - 1500));
};

child.on('spawn', feed);

child.on('exit', (code, signal) => {
  clearInterval(t);
  const report = {
    mode, fullscreen, args, spawnError, code, signal,
    exitAfterMs: Date.now() - startedAt,
    messages,
    fpsSamples: fpsSamples.map(s => s.fps),
    timing: {
      spawnToNavDoneMs: startNav.at,
      spawnToWebviewReadyMs: (messages.find(m => m.type === 'webview-ready') || {})._atMs ?? null,
      spawnToFirstFpsMs: (fpsSamples[0] || {})._atMs ?? null,
    },
    screenshot: fs.existsSync(shotPath) ? { path: shotPath, bytes: fs.statSync(shotPath).size } : null,
    desktopScreenshot: fs.existsSync(desktopShotPath) ? { path: desktopShotPath, bytes: fs.statSync(desktopShotPath).size } : null,
    stderr: stderr.slice(0, 2000),
    fpsStats: (() => {
      const v = fpsSamples.map(s => s.fps);
      if (!v.length) return null;
      const sorted = [...v].sort((a, b) => a - b);
      return {
        count: v.length,
        avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1),
        min: sorted[0], max: sorted[sorted.length - 1],
        p5: sorted[Math.floor(sorted.length * 0.05)],
        longFrames: fpsSamples[fpsSamples.length - 1]?.longFrames ?? null,
        heapMB: fpsSamples[fpsSamples.length - 1]?.heapMB ?? null,
        canvases: fpsSamples[fpsSamples.length - 1]?.canvases ?? null,
        size: fpsSamples[fpsSamples.length - 1] ? `${fpsSamples[fpsSamples.length - 1].w}x${fpsSamples[fpsSamples.length - 1].h}@${fpsSamples[fpsSamples.length - 1].dpr}x` : null,
      };
    })(),
  };
  fs.writeFileSync(path.join(OUT, `report-${tag}.json`), JSON.stringify(report, null, 2));
  const fps = report.fpsStats;
  console.log(`exit=${code} signal=${signal} after=${report.exitAfterMs}ms`);
  console.log(`timing: ${JSON.stringify(report.timing)}`);
  console.log(`fps: ${fps ? JSON.stringify(fps) : 'NONE'}`);
  console.log(`screenshot: ${JSON.stringify(report.screenshot)}`);
  console.log(`desktop: ${JSON.stringify(report.desktopScreenshot)}`);
  console.log(`stderr: ${stderr.slice(0, 800)}`);
  const types = messages.filter(m => m.type).map(m => m.type);
  console.log(`messages: ${types.slice(0, 40).join(', ')}${types.length > 40 ? '…' : ''}`);
});
