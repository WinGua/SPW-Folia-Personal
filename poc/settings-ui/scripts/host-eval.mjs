// Debug probe for the host injection path: sends `eval` commands after the page has loaded and
// prints the host's `eval-result` lines, so a silent module-load failure is visible.
//
//   node scripts/host-eval.mjs "expr1" "expr2" ...
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_ROOT = path.resolve(__dirname, '..');
const WEBVIEW_ROOT = path.resolve(SETTINGS_ROOT, '..', 'webview');
const EXE = path.join(WEBVIEW_ROOT, 'host', 'build', 'spw-folia-host.exe');
const BUNDLE = path.join(WEBVIEW_ROOT, 'dist', 'dist');
const OUT = path.join(WEBVIEW_ROOT, 'host', 'out', 'inject-debug');
fs.mkdirSync(OUT, { recursive: true });

const exprs = process.argv.slice(2);
const probes = exprs.length
    ? exprs
    : [
        'location.href',
        '!!window.__SPW_FOLIA__',
        '!!window.__SPW_FOLIA_UI__',
        'Array.from(document.scripts).map(s=>s.src||"(inline)").filter(s=>s.includes("settings")||s.includes("spw"))',
        'performance.getEntriesByType("resource").map(e=>e.name+" :: "+e.responseStatus+" "+Math.round(e.duration)+"ms").filter(n=>n.includes("settings"))',
        'document.querySelectorAll("style[data-spw-settings-ui]").length',
        'document.body ? document.body.innerHTML.length : -1',
        'window.__SPW_SETTINGS_LOADED__ === true',
    ];

const child = spawn(EXE, [
    '--bundle', BUNDLE,
    '--windowed', '--width', '1600', '--height', '1000',
    '--settings-dir', path.join(SETTINGS_ROOT, 'dist'),
    '--settings-entry', 'settings-ui.js',
    '--duration', '9000',
    '--user-data', path.join(OUT, 'profile'),
    '--title', 'inject probe',
    '--demo', '--no-topmost',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });

let buf = '';
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', d => { stderr += d; });
const results = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
            const msg = JSON.parse(line);
            if (process.env.HOST_EVAL_VERBOSE) console.log('[host]', line.slice(0, 240));
            if (msg.t === 'eval-result') results.push(String(msg.value));
            if (msg.t === 'log' && msg.level === 'error') console.log('[page error]', msg.msg);
        } catch { /* raw */ }
    }
});

const send = (payload) => child.stdin.write(JSON.stringify(payload) + '\n');
const timers = [];
timers.push(setTimeout(() => {
    send({ t: 'command', command: 'eval', script: 'window.__SPW_PROBE_ERRORS__=[];window.addEventListener("error",function(e){window.__SPW_PROBE_ERRORS__.push(String(e.message)+" @ "+String(e.filename));});"armed"' });
    send({ t: 'command', command: 'eval', script: 'window.__SPW_PROBE_REJECTIONS__=[];window.addEventListener("unhandledrejection",function(e){window.__SPW_PROBE_REJECTIONS__.push(String(e.reason));});"armed2"' });
}, 400));
for (let i = 0; i < probes.length; i++) {
    timers.push(setTimeout(() => send({ t: 'command', command: 'eval', script: probes[i] }), 2500 + i * 150));
}
timers.push(setTimeout(() => send({ t: 'command', command: 'eval', script: 'JSON.stringify({errors:window.__SPW_PROBE_ERRORS__||[],rejections:window.__SPW_PROBE_REJECTIONS__||[]})' }), 6000));
timers.push(setTimeout(() => child.stdin.write('{"type":"command","command":"close"}\n'), 8500));

child.on('exit', (code, signal) => {
    console.log(`[host-eval] exit code=${code} signal=${signal}`);
    for (const t of timers) clearTimeout(t);
    console.log('--- eval results ---');
    for (const r of results) console.log(r);
    fs.writeFileSync(path.join(OUT, 'eval-results.txt'), results.join('\n\n'));
});
