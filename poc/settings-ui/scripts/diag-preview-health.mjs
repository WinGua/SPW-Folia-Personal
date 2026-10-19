// Scratch diagnostic for the settings-page live preview health (task-15 follow-ups):
//   * placeholder cover assets reachable/decodable from inside the preview iframe,
//   * iframe identity across repeated open/close cycles (no rebuild/leak),
//   * host fps while the overlay is open vs closed (CPU/GPU cost indicator).
//
//   node scripts/diag-preview-health.mjs [--bundle <dir>]
//
// Nothing here ships; it only feeds docs/verification-live-preview-ui.md.
import { spawn } from 'node:child_process';
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
const OUT = path.join(ROOT, 'poc/webview/host/out/diag-preview-health');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(path.join(OUT, 'profile'), { recursive: true, force: true });

const child = spawn(EXE, [
    '--bundle', BUNDLE,
    '--window', '1600x1000', '--force-dsf', '1',
    '--settings-dir', path.join(BUNDLE, 'settings'), '--settings-entry', 'settings-ui.js',
    '--user-data', path.join(OUT, 'profile'),
    '--demo', '--no-topmost', '--keep-alive',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });

const evals = [];
const fps = [];
const errors = [];
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
            if (message.t === 'eval-result') evals.push({ at: Date.now(), value: String(message.value) });
            if (message.t === 'fps') fps.push({ at: Date.now(), fps: message.fps, heapMB: message.heapMB, canvases: message.canvases });
            if (message.t === 'log' && message.level === 'error') errors.push({ at: Date.now(), msg: message.msg });
            if (message.t === 'eval-result') evals[evals.length - 1].at = message.at || Date.now();
        } catch { /* raw */ }
    }
});
const send = (payload) => { try { child.stdin.write(JSON.stringify(payload) + '\n'); } catch { /* closed */ } };
const at = (ms, fn) => setTimeout(fn, ms);
const tag = (label) => Date.now(); // eslint-disable-line no-unused-vars

const childEval = (script) => send({
    t: 'command',
    command: 'eval',
    script: `(function(){
        var f = document.querySelector('[data-spw-live-preview] iframe');
        if (!f || !f.contentWindow) return 'no-iframe';
        try { return f.contentWindow.eval(${JSON.stringify(script)}); }
        catch (error) { return 'ERR:' + String(error && error.message || error); }
    })()`,
});

const coverScript = `(function(){
    var urls = ['/preview/placeholder_cover.jpg', '/preview/placeholder_cover-2.jpg'];
    window.__spwCoverProbe = window.__spwCoverProbe || [];
    urls.forEach(function (url) {
        var entry = { url: url, status: null, ok: false, w: 0, h: 0, error: null };
        entry.fetch = new Promise(function (resolve) {
            fetch(url).then(function (response) { entry.status = response.status; resolve(); })
                .catch(function (error) { entry.error = String(error && error.message || error); resolve(); });
        });
        entry.decode = new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () { entry.ok = true; entry.w = img.naturalWidth; entry.h = img.naturalHeight; resolve(); };
            img.onerror = function () { entry.error = 'decode failed'; resolve(); };
            img.src = url;
        });
        window.__spwCoverProbe.push(entry);
    });
    return 'started';
})()`;
const coverResultScript = `(function(){
    var list = window.__spwCoverProbe || [];
    return JSON.stringify(list.map(function (entry) {
        return { url: entry.url, status: entry.status, ok: entry.ok, w: entry.w, h: entry.h, error: entry.error };
    }));
})()`;

const stateScript = `(function(){
    var wrap = document.querySelector('[data-spw-live-preview]');
    var iframe = wrap && wrap.querySelector('iframe');
    var api = iframe && iframe.contentWindow && iframe.contentWindow.__SPW_FOLIA_PREVIEW__;
    var overlay = document.querySelector('[data-spw-settings-ui]');
    var same = null;
    try { same = !!(iframe && window.__spwTaggedIframe && iframe === window.__spwTaggedIframe); } catch (error) { same = 'ERR'; }
    return JSON.stringify({
        iframeCount: document.querySelectorAll('[data-spw-live-preview] iframe').length,
        sameIframe: same,
        overlayDisplay: overlay ? getComputedStyle(overlay).display : null,
        overlayOpen: overlay ? overlay.getAttribute('data-open') : null,
        ready: wrap ? wrap.getAttribute('data-live-preview-ready') : null,
        paused: api ? api.paused : null,
        frames: api ? api.frames : -1,
        canvases: api ? api.canvases : -1,
        liveFailed: document.querySelectorAll('[data-spw-live-preview] iframe').length === 0,
    });
})()`;
const tagScript = `(function(){
    var iframe = document.querySelector('[data-spw-live-preview] iframe');
    window.__spwTaggedIframe = iframe || null;
    return iframe ? 'tagged' : 'no-iframe';
})()`;

at(300, () => {
    send({ t: 'hello', protocol: 1, pluginVersion: '0.1.6', spwVersion: '1.19.0' });
    send({ t: 'track', id: 'diag', title: '预览健康检查', artist: 'probe', album: 'probe', durationMs: 16800 });
    send({ t: 'lyrics', offsetMs: 0, lines: [{ startMs: 0, endMs: 4000, main: 'プレビュー', sub: 'live preview' }] });
});
// Phase A (0.3-5.4s): overlay closed -> host fps baseline without the preview.
// Phase B (5.5-11.4s): overlay open -> fps with the live preview renderer running.
// Phase C (11.5-16.4s): switch the style to tempera, screenshot and read fps again.
// Phase D (16.5-20.4s): overlay closed again.
// Phase E (21-33s): five more open/close cycles -> iframe identity / no rebuild.
// Phase F (34-44s): final open, tag the iframe, probe the placeholder covers from inside it.
const styleClickScript = `(() => {
    const tiles = [...document.querySelectorAll('button[role=radio]')];
    const tile = tiles.find((b) => b.textContent.trim() === '凝彩');
    if (tile) tile.click();
    return tile ? 'clicked-tempera' : 'no-tile';
})()`;
at(5500, () => send({ t: 'command', command: 'open-settings' }));
at(8000, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(10000, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(11500, () => send({ t: 'command', command: 'eval', script: styleClickScript }));
at(13500, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(14500, () => send({ t: 'command', command: 'screenshot', path: path.join(OUT, 'tempera-open.png') }));
at(16500, () => send({ t: 'command', command: 'close-settings' }));
at(18500, () => send({ t: 'command', command: 'eval', script: stateScript }));
for (let cycle = 0; cycle < 5; cycle += 1) {
    const base = 21000 + cycle * 2400;
    at(base, () => send({ t: 'command', command: 'open-settings' }));
    at(base + 900, () => send({ t: 'command', command: 'eval', script: stateScript }));
    at(base + 1200, () => send({ t: 'command', command: 'close-settings' }));
    at(base + 1700, () => send({ t: 'command', command: 'eval', script: stateScript }));
}
at(34100, () => send({ t: 'command', command: 'open-settings' }));
at(35400, () => send({ t: 'command', command: 'eval', script: tagScript }));
at(35700, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(35900, () => childEval(coverScript));
at(36900, () => childEval(coverResultScript));
at(37600, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(38100, () => send({ t: 'command', command: 'close-settings' }));
at(38700, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(39300, () => send({ t: 'command', command: 'open-settings' }));
at(40500, () => send({ t: 'command', command: 'eval', script: stateScript }));
at(41000, () => send({ t: 'command', command: 'quit' }));
at(42200, () => { try { child.kill(); } catch { /* exited */ } });

const unwrap = (value) => {
    let current = value;
    for (let i = 0; i < 3; i++) {
        if (typeof current !== 'string') break;
        try { current = JSON.parse(current); } catch { return current; }
    }
    return current;
};

child.on('exit', (code) => {
    const parsedEvals = evals.map((entry) => ({ at: entry.at, value: unwrap(entry.value) }));
    const report = {
        exitCode: code,
        evals: parsedEvals,
        errors,
        fpsSamples: fps.length,
        fpsMin: fps.length ? Math.min(...fps.map((s) => s.fps)) : null,
        fpsMax: fps.length ? Math.max(...fps.map((s) => s.fps)) : null,
        fpsAvg: fps.length ? Number((fps.reduce((sum, s) => sum + s.fps, 0) / fps.length).toFixed(1)) : null,
        heapMBMax: fps.length ? Math.max(...fps.map((s) => s.heapMB || 0)) : null,
        canvases: fps.length ? Math.max(...fps.map((s) => s.canvases || 0)) : null,
        fpsTimeline: fps.map((s) => ({ at: s.at, fps: s.fps, heapMB: s.heapMB })),
    };
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
});
