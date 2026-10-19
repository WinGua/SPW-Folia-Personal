// Scratch diagnostic for the settings-page live preview under the real WebView2 host.
//
//   node scripts/diag-host-preview.mjs [--bundle <dir>] [--fresh]
//
// Spawns poc/webview/host/build/spw-folia-host.exe on a bundle (default packaging/web), opens the
// settings overlay via stdin, then evals the top document to inspect the preview iframe: whether the
// child shim ran, how many canvases it drew, and what HTML the virtual host actually served for
// preview.html (the sync XHR tells cache/stale-bundle problems apart from shim bugs).
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
const OUT = path.join(ROOT, 'poc/webview/host/out/diag-preview');
fs.mkdirSync(OUT, { recursive: true });
const userData = arg('--user-data', path.join(OUT, process.argv.includes('--fresh') ? `profile-${Date.now()}` : 'profile'));

const child = spawn(EXE, [
    '--bundle', BUNDLE,
    '--window', '1600x1000', '--force-dsf', '1',
    '--settings-dir', path.join(BUNDLE, 'settings'), '--settings-entry', 'settings-ui.js',
    '--user-data', userData, '--demo', '--no-topmost', '--keep-alive',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });

const results = [];
const raw = [];
const logs = [];
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        raw.push(line);
        try {
            const message = JSON.parse(line);
            if (message.t === 'eval-result') results.push(String(message.value));
            if (message.t === 'log' && message.level === 'error') logs.push(message.msg);
            if (message.t === 'ready') logs.push('host-ready');
        } catch { /* raw line */ }
    }
});

const send = (payload) => { try { child.stdin.write(JSON.stringify(payload) + '\n'); } catch { /* closed */ } };
const at = (ms, fn) => setTimeout(fn, ms);

at(300, () => {
    send({ t: 'hello', protocol: 1, pluginVersion: '0.1.5', spwVersion: '1.19.0' });
    send({ t: 'track', id: 'diag', title: '预览探针', artist: 'probe', album: 'probe', durationMs: 16800 });
    send({ t: 'lyrics', offsetMs: 0, lines: [{ startMs: 0, endMs: 4000, main: 'プレビュー', sub: 'live preview' }] });
});
at(1200, () => send({ t: 'command', command: 'open-settings' }));
at(2200, () => send({ t: 'command', command: 'eval', script: 'window.__SPW_PREVIEW_MSGS__=[];window.addEventListener("message",function(e){if(e.data&&e.data.__spwFoliaPreview===1)window.__SPW_PREVIEW_MSGS__.push(String(e.data.kind));});"armed"' }));
at(5000, () => send({
    t: 'command',
    command: 'eval',
    script: `(function(){
        try {
            var f = document.querySelector('[data-spw-live-preview] iframe');
            if (!f) return JSON.stringify({ noIframe: true, hasWrapper: !!document.querySelector('[data-spw-live-preview]') });
            var w = f.contentWindow, d = f.contentDocument;
            var served = null;
            try {
                var xhr = new XMLHttpRequest(); xhr.open('GET', '/preview.html', false); xhr.send(null);
                served = { status: xhr.status, length: xhr.responseText.length, hasShimTag: xhr.responseText.indexOf('preview-shim.js') >= 0 };
            } catch (error) { served = { error: String(error && error.message || error) }; }
            return JSON.stringify({
                shim: !!(w && w.__SPW_FOLIA_PREVIEW_SHIM__),
                api: w && w.__SPW_FOLIA_PREVIEW__ ? {
                    receivedConfig: w.__SPW_FOLIA_PREVIEW__.receivedConfig,
                    frames: w.__SPW_FOLIA_PREVIEW__.frames,
                    canvases: w.__SPW_FOLIA_PREVIEW__.canvases,
                } : null,
                canvases: d ? d.querySelectorAll('canvas').length : -1,
                scripts: d ? Array.from(d.scripts).map(function(s){return s.src || '(inline)';}).slice(0, 5) : [],
                served: served,
                messages: window.__SPW_PREVIEW_MSGS__ || null,
            });
        } catch (error) { return 'ERR:' + String(error && error.message || error); }
    })()`,
}));
const sample = `(function(){
    var f = document.querySelector('[data-spw-live-preview] iframe');
    var api = f && f.contentWindow && f.contentWindow.__SPW_FOLIA_PREVIEW__;
    return JSON.stringify({
        frames: api ? api.frames : -1,
        paused: api ? api.paused : null,
        canvases: api ? api.canvases : -1,
        mode: window.__SPW_FOLIA_LAST_CONFIG__ ? window.__SPW_FOLIA_LAST_CONFIG__.visualizerMode : null,
    });
})()`;
const clickPause = `(function(){
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var target = buttons.filter(function(b){ return /暂停预览|继续预览|恢复预览|pause preview|resume preview/i.test(b.getAttribute('aria-label') || ''); })[0];
    if (!target) return 'no-button';
    target.click();
    return 'clicked:' + (target.getAttribute('aria-label') || '');
})()`;
const clickStyle = (label) => `(function(){
    var tiles = Array.prototype.slice.call(document.querySelectorAll('button[role=radio]'));
    var target = tiles.filter(function(b){ return (b.textContent || '').trim() === '${label}'; })[0];
    if (!target) return 'no-tile';
    target.click();
    return 'clicked:${label}';
})()`;

at(6300, () => send({ t: 'command', command: 'eval', script: clickPause }));
at(6500, () => send({ t: 'command', command: 'eval', script: sample }));
at(7600, () => send({ t: 'command', command: 'eval', script: sample }));
at(7800, () => send({ t: 'command', command: 'eval', script: clickPause }));
at(8600, () => send({ t: 'command', command: 'eval', script: sample }));
at(8800, () => send({ t: 'command', command: 'eval', script: clickStyle('凝彩') }));
at(10400, () => send({ t: 'command', command: 'eval', script: sample }));
at(10600, () => send({ t: 'command', command: 'eval', script: `(function(){ var f = document.querySelector('[data-spw-live-preview] iframe'); var d = f && f.contentDocument; return JSON.stringify({ canvases: d ? d.querySelectorAll('canvas').length : -1 }); })()` }));
const NL = String.fromCharCode(10);
at(11000, () => child.stdin.write(JSON.stringify({ t: 'command', command: 'close' }) + NL));
at(11500, () => { try { child.kill(); } catch { /* exited */ } });
child.on('exit', (code) => {
    console.log(`[diag-host-preview] exit code=${code} bundle=${BUNDLE} userData=${userData}`);
    console.log('--- eval results ---');
    for (const result of results) console.log(result);
    fs.writeFileSync(path.join(OUT, 'last-run.jsonl'), raw.join(String.fromCharCode(10)) + String.fromCharCode(10));
    console.log('--- host errors ---');
    console.log(logs.join('\n') || '(none)');
});
