// Functional check of the §7.5 chrome contract inside the real host: `__SPW_FOLIA__.ui`, the gear
// click, capture-phase ESC (overlay open) and ESC passthrough (overlay closed), plus proof that the
// open overlay is never unmounted when it is hidden.
//
//   node scripts/host-ui-check.mjs
//
// Requires poc/settings-ui/dist built and poc/webview/host/build/spw-folia-host.exe.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_ROOT = path.resolve(__dirname, '..');
const WEBVIEW_ROOT = path.resolve(SETTINGS_ROOT, '..', 'webview');
const EXE = path.join(WEBVIEW_ROOT, 'host', 'build', 'spw-folia-host.exe');
const BUNDLE = path.join(WEBVIEW_ROOT, 'dist', 'dist');
const OUT = path.join(WEBVIEW_ROOT, 'host', 'out', 'ui-check');
fs.mkdirSync(OUT, { recursive: true });

const child = spawn(EXE, [
    '--bundle', BUNDLE,
    '--windowed', '--width', '1600', '--height', '1000',
    // No --force-dsf on purpose: production runs the display's real DSF (1.8 here); this probe
    // proves the injected overlay works on that CSS viewport too.
    '--settings-dir', path.join(SETTINGS_ROOT, 'dist'),
    '--settings-entry', 'settings-ui.js',
    '--duration', '30000',
    '--user-data', path.join(OUT, 'profile'),
    '--title', 'settings UI contract check',
    '--demo', '--no-topmost',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });

const results = [];
const errors = [];
let buf = '';
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
            if (msg.t === 'eval-result') results.push(String(msg.value));
            if (msg.t === 'log' && msg.level === 'error') errors.push(msg.msg);
        } catch { /* ignore non-JSON lines */ }
    }
});
const stderr = [];
child.stderr.setEncoding('utf8');
child.stderr.on('data', d => stderr.push(d));

const send = payload => child.stdin.write(JSON.stringify(payload) + '\n');
const at = (delay, script) => setTimeout(() => send({ t: 'command', command: 'eval', script }), delay);

// Each action is followed by a separate read ~800 ms later: React commits asynchronously, so reading
// in the same eval would observe the pre-commit DOM/module state.
const reads = {
    initial: `JSON.stringify({uiApi: typeof window.__SPW_FOLIA__?.ui?.openSettings, isOpen: window.__SPW_FOLIA__.ui.isSettingsOpen(), overlay: document.querySelector('[data-spw-settings-ui]')?.dataset.open, gear: !!document.querySelector('[data-spw-chrome="settings"]')})`,
    afterGear: `JSON.stringify({afterGearClick: window.__SPW_FOLIA__.ui.isSettingsOpen(), overlay: document.querySelector('[data-spw-settings-ui]').dataset.open, gearVisible: document.querySelector('[data-spw-chrome="settings"]').dataset.visible})`,
    afterEsc: `JSON.stringify({afterEsc: window.__SPW_FOLIA__.ui.isSettingsOpen(), overlay: document.querySelector('[data-spw-settings-ui]').dataset.open})`,
    afterHostOpen: `JSON.stringify({afterHostOpen: window.__SPW_FOLIA__.ui.isSettingsOpen(), overlay: document.querySelector('[data-spw-settings-ui]').dataset.open})`,
    afterHostClose: `JSON.stringify({afterHostClose: window.__SPW_FOLIA__.ui.isSettingsOpen(), overlay: document.querySelector('[data-spw-settings-ui]').dataset.open})`,
    closedEsc: `JSON.stringify({closedEscPrevented: window.__SPW_CLOSED_ESC_PREVENTED__, overlay: document.querySelector('[data-spw-settings-ui]').dataset.open, previewImg: !!document.querySelector('[data-spw-settings-ui] img'), styleWindows: document.querySelectorAll('.st-window').length})`,
    reopened: `JSON.stringify({reopen: window.__SPW_FOLIA__.ui.isSettingsOpen(), overlay: document.querySelector('[data-spw-settings-ui]').dataset.open, styleWindows: document.querySelectorAll('.st-window').length})`,
    summary: `JSON.stringify({mode: (window.__SPW_FOLIA_LAST_CONFIG__ || {}).visualizerMode ?? null, open: window.__SPW_FOLIA__.ui.isSettingsOpen()})`,
    gearHit: `JSON.stringify((() => {
        const gear = document.querySelector('[data-spw-chrome="settings"]');
        const style = getComputedStyle(gear);
        const rect = gear.getBoundingClientRect();
        const cx = Math.round(rect.left + rect.width / 2);
        const cy = Math.round(rect.top + rect.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return {
            visible: gear.dataset.visible,
            pointerEvents: style.pointerEvents,
            center: [cx, cy],
            hitIsGear: hit === gear || gear.contains(hit),
            hitTag: hit ? hit.tagName : null,
            hitChrome: hit && hit.getAttribute ? hit.getAttribute('data-spw-chrome') : null,
        };
    })())`,
    gearHitHidden: `JSON.stringify((() => {
        const gear = document.querySelector('[data-spw-chrome="settings"]');
        const style = getComputedStyle(gear);
        const rect = gear.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
        return { visible: gear.dataset.visible, pointerEvents: style.pointerEvents, hitIsGear: hit === gear || gear.contains(hit), hitTag: hit ? hit.tagName : null };
    })())`,
};

// The gear fades after 2.5 s of pointer idle: un-hide it with a real pointermove first, then hit-test
// its centre with elementFromPoint (pointer-events:none targets are skipped by elementFromPoint, so
// this is the same hit-test the browser does for a real click).
at(1500, `(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 800, clientY: 500, bubbles: true })); return 'pointer-show'; })()`);
at(1900, reads.gearHit);
at(2200, reads.initial);
at(2500, `document.querySelector('[data-spw-chrome="settings"]').click(); 'gear-clicked'`);
at(3300, reads.afterGear);
at(3900, `(() => { const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); window.dispatchEvent(event); return 'esc-open-dispatched'; })()`);
at(4700, reads.afterEsc);
at(5300, `window.__SPW_FOLIA__.ui.openSettings(); 'host-open'`);
at(6100, reads.afterHostOpen);
at(6700, `window.__SPW_FOLIA__.ui.closeSettings(); 'host-close'`);
at(7500, reads.afterHostClose);
at(8100, `(() => { const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); window.__SPW_CLOSED_ESC_PREVENTED__ = event.defaultPrevented; window.dispatchEvent(event); return 'esc-closed-dispatched'; })()`);
at(9100, reads.closedEsc);
at(9700, `window.__SPW_FOLIA__.ui.openSettings(); 'reopen'`);
at(10500, reads.reopened);
at(11100, `(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 800, clientY: 500, bubbles: true })); return 'pointer-show-idle'; })()`);
at(11400, reads.summary);
at(12200, reads.gearHit);
at(13500, reads.gearHitHidden);

setTimeout(() => child.stdin.write('{"type":"command","command":"close"}\n'), 16000);

child.on('exit', code => {
    console.log(`[ui-check] exit code=${code} host errors=${errors.length}`);
    for (const error of errors.slice(0, 8)) console.log('  [host error]', String(error).slice(0, 300));
    if (stderr.length) console.log('[ui-check] stderr:', stderr.join('').slice(0, 1200));
    console.log('--- results (in page order) ---');
    for (const r of results) console.log(r);
    fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n') + '\n');
});
