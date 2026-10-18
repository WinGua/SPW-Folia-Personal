// Host-injection smoke test for the settings UI bundle.
//
// Runs the WebView2 host spike (poc/webview/host/build/spw-folia-host.exe) against the real Folia
// dist page, injects our built `dist/` through the host's `--settings-dir/--settings-entry` flags,
// asks the host to open the panel (`{"type":"command","command":"open-settings"}` on stdin), and
// writes the host's stdout log + the host screenshot.
//
//   node scripts/host-inject.mjs [--no-open] [--shot-at 7000] [--duration 14000]
//
// Requires: poc/settings-ui/dist built (`pnpm build`) and poc/webview/host/build/spw-folia-host.exe.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_ROOT = path.resolve(__dirname, '..');
const WEBVIEW_ROOT = path.resolve(SETTINGS_ROOT, '..', 'webview');
const EXE = path.join(WEBVIEW_ROOT, 'host', 'build', 'spw-folia-host.exe');
const BUNDLE_DEFAULT = path.join(WEBVIEW_ROOT, 'dist', 'dist');
const SETTINGS_DIST = path.join(SETTINGS_ROOT, 'dist');
const OUT = path.join(WEBVIEW_ROOT, 'host', 'out');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = argv.indexOf('--' + name);
    if (i < 0) return fallback;
    const next = argv[i + 1];
    return next && !next.startsWith('--') ? next : true;
};
const openPanel = !argv.includes('--no-open');
const shotAtMs = Number(opt('shot-at', 7000));
const durationMs = Number(opt('duration', 14000));
const shotPath = path.join(OUT, opt('shot', 'settings-inject.png'));
const fullscreen = argv.includes('--fullscreen');
const forceDsf = opt('force-dsf', null);
const logPath = path.join(OUT, 'settings-inject.log.jsonl');
// --bundle <dir> overrides the Folia dist root; --auto-settings drops --settings-dir/--settings-entry
// so the host discovers the packaged `settings/` subdir on its own (packaging/web verification).
const BUNDLE = path.resolve(String(opt('bundle', BUNDLE_DEFAULT)));
const autoSettings = argv.includes('--auto-settings');

fs.mkdirSync(OUT, { recursive: true });

const args = [
    '--bundle', BUNDLE,
    // Production runs the WebView2 fullscreen (visualizer) with the overlay drawn over the full CSS
    // viewport; --fullscreen reproduces that. --windowed + explicit size is for dev inspection only.
    ...(fullscreen ? ['--fullscreen'] : ['--windowed', '--width', '1600', '--height', '1000']),
    ...(forceDsf != null ? ['--force-dsf', String(forceDsf)] : []),
    ...(autoSettings ? [] : ['--settings-dir', SETTINGS_DIST, '--settings-entry', 'settings-ui.js']),
    '--screenshot', shotPath,
    '--shot-at', String(shotAtMs),
    '--duration', String(durationMs),
    '--user-data', path.join(OUT, 'webview2-profile-settings'),
    '--title', 'spw-folia settings UI injection',
    '--demo',
];
console.log(`[host-inject] ${EXE} ${args.join(' ')}`);
const child = spawn(EXE, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });

const lines = [];
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        lines.push(line);
        let msg = null;
        try { msg = JSON.parse(line); } catch { /* keep raw */ }
        if (msg && msg.t === 'log' && (msg.level === 'error' || msg.level === 'warn')) {
            console.log(`[host ${msg.level}] ${msg.msg}`);
        }
        if (msg && msg.t === 'ready') {
            console.log(`[host-inject] webview ready, webview2=${msg.webviewVersion}`);
        }
    }
});
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', d => { stderr += d; });
child.on('error', e => { console.error('[host-inject] spawn failed:', e.message); });

// The host opens the panel on stdin command after the page has taken the first config.
const timers = [];
if (openPanel) {
    for (const delay of [2500, 6000]) {
        timers.push(setTimeout(() => {
            console.log(`[host-inject] stdin: open-settings (t+${delay}ms)`);
            try { child.stdin.write(JSON.stringify({ t: 'command', command: 'open-settings' }) + '\n'); } catch { /* closed */ }
        }, delay));
    }
}

child.on('exit', code => {
    for (const timer of timers) clearTimeout(timer);
    fs.writeFileSync(logPath, lines.join('\n') + '\n');
    console.log(`[host-inject] exit code=${code} screenshot=${shotPath} lines=${lines.length} log=${logPath}`);
    if (stderr.trim()) console.log('[host-inject] stderr:\n' + stderr.trim().slice(0, 4000));
    const errors = lines.filter(line => line.includes('"level":"error"'));
    console.log(`[host-inject] host/page errors: ${errors.length}`);
    for (const error of errors.slice(0, 10)) console.log('  ' + error.slice(0, 400));
    const shot = fs.existsSync(shotPath) ? fs.statSync(shotPath) : null;
    console.log(`[host-inject] screenshot bytes=${shot ? shot.size : 0}`);
});
