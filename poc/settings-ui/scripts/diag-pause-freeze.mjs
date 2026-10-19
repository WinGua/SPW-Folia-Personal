// Scratch diagnostic (task-15): why does the paused live preview still change, and does stopping the
// child page's requestAnimationFrame freeze it completely?
//
//   node scripts/diag-pause-freeze.mjs [--bundle <dir>]
//
// Runs the real hosted bundle, opens the settings overlay, pauses the preview, sprays screenshots,
// then replaces the child window's requestAnimationFrame with a no-op and sprays two more. Compares
// the two pairs inside the iframe rect. Nothing here ships; it only decides what the pause contract
// needs from the preview shim.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXE = path.join(ROOT, 'poc/webview/host/build/spw-folia-host.exe');
const arg = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const BUNDLE = path.resolve(arg('--bundle', path.join(ROOT, 'packaging/web')));
const OUT = path.join(ROOT, 'poc/webview/host/out/diag-pause-freeze');
const PROFILE_TAG = arg('--profile-tag', 'profile');
fs.mkdirSync(OUT, { recursive: true });
const { PNG } = createRequire(path.join(ROOT, 'poc/webview/server/package.json'))('pngjs');

const child = spawn(EXE, [
    '--bundle', BUNDLE,
    '--window', '1600x1000', '--force-dsf', '1',
    '--settings-dir', path.join(BUNDLE, 'settings'), '--settings-entry', 'settings-ui.js',
    '--user-data', path.join(OUT, PROFILE_TAG),
    '--demo', '--no-topmost', '--keep-alive',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });

const evals = [];
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
            const message = JSON.parse(line);
            if (message.t === 'eval-result') evals.push(String(message.value));
        } catch { /* raw */ }
    }
});
const send = (payload) => { try { child.stdin.write(JSON.stringify(payload) + '\n'); } catch { /* closed */ } };
const at = (ms, fn) => setTimeout(fn, ms);
const shot = (name) => send({ t: 'command', command: 'screenshot', path: path.join(OUT, name) });

const pauseScript = `(function(){
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var target = buttons.filter(function(b){ return /暂停预览|继续预览|恢复预览|pause preview|resume preview/i.test(b.getAttribute('aria-label') || ''); })[0];
    if (!target) return 'no-button';
    target.click();
    return 'clicked:' + (target.getAttribute('aria-label') || '');
})()`;
const stateScript = `(function(){
    var f = document.querySelector('[data-spw-live-preview] iframe');
    var api = f && f.contentWindow && f.contentWindow.__SPW_FOLIA_PREVIEW__;
    var wrap = document.querySelector('[data-spw-live-preview]');
    var rect = f ? f.getBoundingClientRect() : null;
    var clip = wrap ? wrap.getBoundingClientRect() : null;
    return JSON.stringify({ paused: api ? api.paused : null, frames: api ? api.frames : -1,
        rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
        clip: clip ? { x: clip.x, y: clip.y, w: clip.width, h: clip.height } : null });
})()`;
const gateScript = `(function(){
    var f = document.querySelector('[data-spw-live-preview] iframe');
    var w = f && f.contentWindow;
    if (!w) return 'no-iframe';
    w.__spwRealRaf = w.requestAnimationFrame;
    w.requestAnimationFrame = function () { return 0; };
    return 'raf-gated';
})()`;
const staticConfigScript = `(function(){
    var f = document.querySelector('[data-spw-live-preview] iframe');
    var w = f && f.contentWindow;
    if (!w) return 'no-iframe';
    var config = window.__SPW_FOLIA_LAST_CONFIG__ || (window.__SPW_FOLIA__ && window.__SPW_FOLIA__.lastConfig && window.__SPW_FOLIA__.lastConfig());
    if (!config) return 'no-config';
    var frozen = Object.assign({}, config, { staticMode: true });
    w.postMessage({ __spwFoliaPreview: 1, kind: 'config', payload: frozen }, '*');
    return 'static-config-sent';
})()`;
const liveConfigScript = `(function(){
    var f = document.querySelector('[data-spw-live-preview] iframe');
    var w = f && f.contentWindow;
    if (!w) return 'no-iframe';
    var config = window.__SPW_FOLIA_LAST_CONFIG__ || (window.__SPW_FOLIA__ && window.__SPW_FOLIA__.lastConfig && window.__SPW_FOLIA__.lastConfig());
    if (!config) return 'no-config';
    w.postMessage({ __spwFoliaPreview: 1, kind: 'config', payload: config }, '*');
    return 'live-config-sent';
})()`;
const ungateScript = `(function(){
    var f = document.querySelector('[data-spw-live-preview] iframe');
    var w = f && f.contentWindow;
    if (!w || !w.__spwRealRaf) return 'no-gate';
    w.requestAnimationFrame = w.__spwRealRaf;
    return 'raf-restored';
})()`;

at(300, () => {
    send({ t: 'hello', protocol: 1, pluginVersion: '0.1.5', spwVersion: '1.19.0' });
    send({ t: 'track', id: 'diag', title: '预览探针', artist: 'probe', album: 'probe', durationMs: 16800 });
    send({ t: 'lyrics', offsetMs: 0, lines: [{ startMs: 0, endMs: 4000, main: 'プレビュー', sub: 'live preview' }] });
});
at(1200, () => send({ t: 'command', command: 'open-settings' }));
at(5000, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(5200, () => send({ t: 'command', command: 'eval', script: pauseScript }));
at(6200, () => shot('p1-paused.png'));
at(7400, () => shot('p2-paused.png'));
at(7600, () => send({ t: 'command', command: 'eval', script: gateScript }));
at(8200, () => shot('p3-raf-gated.png'));
at(9400, () => shot('p4-raf-gated.png'));
at(9600, () => send({ t: 'command', command: 'eval', script: ungateScript }));
at(9800, () => send({ t: 'command', command: 'eval', script: staticConfigScript }));
at(10400, () => shot('p5-static.png'));
at(11600, () => shot('p6-static.png'));
at(11800, () => send({ t: 'command', command: 'eval', script: liveConfigScript }));
at(12400, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(12800, () => send({ t: 'command', command: 'close' }));
at(13300, () => { try { child.kill(); } catch { /* exited */ } });

const diffPng = (fileA, fileB, crop) => {
    const a = PNG.sync.read(fs.readFileSync(fileA));
    const b = PNG.sync.read(fs.readFileSync(fileB));
    const x0 = Math.round(crop.x), y0 = Math.round(crop.y);
    const x1 = Math.round(crop.x + crop.w), y1 = Math.round(crop.y + crop.h);
    let changed = 0;
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
            const i = (y * a.width + x) * 4;
            const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
            if (d > 24) changed++;
            sum += d;
            count++;
        }
    }
    return { ratio: changed / count, meanAbsDiff: sum / count, sampled: count };
};

const unwrap = (value) => {
    let current = value;
    for (let i = 0; i < 3; i++) {
        if (typeof current !== 'string') break;
        try { current = JSON.parse(current); } catch { return current; }
    }
    return current;
};

child.on('exit', (code) => {
    let state = null;
    for (const value of evals) {
        const parsed = unwrap(value);
        if (parsed && typeof parsed === 'object' && parsed.rect) state = parsed;
    }
    const report = { exitCode: code, evals, state };
    const visible = state && state.rect && state.clip ? {
        x: Math.max(state.rect.x, state.clip.x),
        y: Math.max(state.rect.y, state.clip.y),
        w: Math.min(state.rect.x + state.rect.w, state.clip.x + state.clip.w) - Math.max(state.rect.x, state.clip.x),
        h: Math.min(state.rect.y + state.rect.h, state.clip.y + state.clip.h) - Math.max(state.rect.y, state.clip.y),
    } : null;
    report.visibleCrop = visible;
    if (visible) {
        report.visibleDiffs = {
            paused: diffPng(path.join(OUT, 'p1-paused.png'), path.join(OUT, 'p2-paused.png'), visible),
            rafGated: diffPng(path.join(OUT, 'p3-raf-gated.png'), path.join(OUT, 'p4-raf-gated.png'), visible),
            staticMode: diffPng(path.join(OUT, 'p5-static.png'), path.join(OUT, 'p6-static.png'), visible),
        };
    }
    if (state && state.rect) {
        report.diffs = {
            paused: diffPng(path.join(OUT, 'p1-paused.png'), path.join(OUT, 'p2-paused.png'), state.rect),
            rafGated: diffPng(path.join(OUT, 'p3-raf-gated.png'), path.join(OUT, 'p4-raf-gated.png'), state.rect),
            staticMode: diffPng(path.join(OUT, 'p5-static.png'), path.join(OUT, 'p6-static.png'), state.rect),
        };
    }
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
});
