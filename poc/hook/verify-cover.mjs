#!/usr/bin/env node
// Local verification for the m02706 fixes (run after `bash packaging/build-package.sh`):
//  1) settings overlay screenshot  -> proves the 智能动感模式 card is gone
//  2) visualizer screenshot with an ORANGE cover -> proves 封面取色 reaches the renderer
//  3) same with a near-black cover (control) -> pixel comparison shows the tint difference
// Usage: node poc/hook/verify-cover.mjs [--out /tmp/folia-verify]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const exe = resolve(root, 'poc/webview/host/build/spw-folia-host.exe');
const bundle = resolve(root, 'packaging/web');
const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '/tmp/folia-verify';
mkdirSync(outDir, { recursive: true });

const coverOrange = 'data:image/png;base64,' + readFileSync(resolve(here, 'fixtures/cover-orange.b64'), 'utf8').trim();
const coverDark = 'data:image/png;base64,' + readFileSync(resolve(here, 'fixtures/cover-dark.b64'), 'utf8').trim();
const settings = JSON.parse(readFileSync(resolve(root, 'packaging/testdata/default-settings.json'), 'utf8'));

const LINES = [
  { startMs: 0, endMs: 4200, main: '封面取色测试', sub: 'cover colour probe', cells: [{ startMs: 0, endMs: 2100, text: '封面' }, { startMs: 2100, endMs: 4200, text: '取色测试' }] },
  { startMs: 4200, endMs: 8400, main: '光が満ちて', sub: 'light overflows', cells: [{ startMs: 4200, endMs: 6300, text: '光が' }, { startMs: 6300, endMs: 8400, text: '満ちて' }] },
  { startMs: 8400, endMs: 12600, main: '君の声が', sub: 'your voice', cells: [{ startMs: 8400, endMs: 10500, text: '君の' }, { startMs: 10500, endMs: 12600, text: '声が' }] },
  { startMs: 12600, endMs: 16800, main: '向远方回响', sub: 'echoes far away', cells: [{ startMs: 12600, endMs: 14700, text: '向远方' }, { startMs: 14700, endMs: 16800, text: '回响' }] },
];

function run(kind, cover, shots) {
  return new Promise((resolveRun) => {
    const log = [];
    const child = spawn(exe, [
      '--bundle', bundle, ...(process.argv.includes('--fullscreen') ? ['--fullscreen'] : ['--window', '1600x900']), '--bundle-version', '0.1.2',
      '--settings-dir', resolve(bundle, 'settings'), '--settings-entry', 'settings-ui.js',
    ], { cwd: root, windowsHide: false });
    child.stdin.on('error', () => { /* host may close stdin during shutdown */ });
    const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* closed */ } };
    const rl = createInterface({ input: child.stdout });
    let ready = false, pump = null, stage = 0;
    const timeline = [];
    rl.on('line', (line) => {
      timeline.push(line);
      if (!ready && line.includes('"t":"ready"')) {
        ready = true;
        send({ t: 'hello', protocol: 1, pluginVersion: '0.1.2', spwVersion: '1.19.0' });
        send({ t: 'settings', settings });
        send({ t: 'lyrics', lines: LINES, offsetMs: 0 });
        send({ t: 'track', id: 'verify-cover', title: '封面取色测试', artist: 'probe', album: 'probe', durationMs: 16800, coverDataUrl: cover });
        pump = setInterval(() => {
          send({ t: 'state', posMs: 900 + Date.now() % 12000, durationMs: 16800, playing: true, rate: 1, tsMs: Date.now() });
        }, 100);
        (async () => {
          await delay(2600);
          send({ t: 'command', command: 'open-settings' });
          await delay(900);
          send({ t: 'command', command: 'screenshot', path: shots.overlay });
          await delay(900);
          send({ t: 'command', command: 'close-settings' });
          send({ t: 'command', command: 'eval', script: '(function(){var c=document.createElement("canvas");var i=document.querySelector("img");if(!i||!i.complete||!i.naturalWidth)return "cover-img:"+(i?i.src.slice(0,42):"none");c.width=1;c.height=1;var x=c.getContext("2d");x.drawImage(i,0,0,1,1);var d=x.getImageData(0,0,1,1).data;return "cover-px:"+d[0]+","+d[1]+","+d[2]+","+d[3]+" img:"+i.src.slice(0,42);})()' });
          await delay(1600);
          send({ t: 'command', command: 'screenshot', path: shots.visualizer });
          await delay(700);
          send({ t: 'command', command: 'eval', script: '(function(){return "settings-ui:"+(window.__SPW_FOLIA__&&window.__SPW_FOLIA__.ui?"ui":"no-ui")+" smart-beat:"+(document.body.innerText.indexOf("智能动感模式")>=0?"text-present":"text-absent")})()' });
          await delay(700);
          send({ t: 'quit' });
          stage = 2;
        })();
      }
    });
    child.on('exit', (code) => {
      if (pump) clearInterval(pump);
      writeFileSync(resolve(outDir, `log-${kind}.jsonl`), timeline.join('\n') + '\n');
      resolveRun({ kind, code, lines: timeline.length, tail: timeline.slice(-25) });
    });
    setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 30000);
  });
}

const overlay = resolve(outDir, 'overlay.png');
const r1 = await run('orange', coverOrange, { overlay, visualizer: resolve(outDir, 'visualizer-orange.png') });
await delay(1800);
const r2 = await run('dark', coverDark, { overlay: resolve(outDir, 'overlay-dark.png'), visualizer: resolve(outDir, 'visualizer-dark.png') });
writeFileSync(resolve(outDir, 'harness-report.json'), JSON.stringify({ r1, r2 }, null, 2));
console.log(JSON.stringify({ outDir, r1: { kind: r1.kind, code: r1.code, lines: r1.lines }, r2: { kind: r2.kind, code: r2.code, lines: r2.lines } }, null, 2));
