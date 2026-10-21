#!/usr/bin/env node
// Packaged-host acceptance for the v0.3.0 transparent-window HUD fix.
//
// While the player page is transparent the host relays the mouse through an invisible input
// catcher, so WebView2 never receives native hover: every forwarded move is followed by a
// mouse-leave, and the HUD used to expand-then-collapse forever. PlaybackBar now decides hover
// from pointermove coordinates against the settled HUD rect. This script reproduces the shipped
// transparent-window conditions and asserts:
//   1. panel cleanup: right-bottom panel keeps only the two rows (no hint/note copy),
//   2. hover the collapsed pill  -> data-expanded=true, data-flat=true,
//   3. move the pointer away     -> collapses,
//   4. idle 3.2 s                -> slides out (data-hidden=true),
//   5. move back onto the bar    -> wakes and expands again.
//
// Usage: node packaging/tools/verify-transparent-hud.mjs
// Exit code 0 = PASS, 1 = FAIL, 2 = missing packaged helper.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PKG = join(ROOT, 'packaging');
const OUT = join(PKG, 'out');
mkdirSync(OUT, { recursive: true });

const exe = join(PKG, 'native', 'spw-folia-host.exe');
if (!existsSync(exe)) {
    console.error('FAIL  missing packaged host: ' + exe + ' (run bash packaging/build-package.sh first)');
    process.exit(2);
}
const WORK = join(OUT, 'transparent-hud');
mkdirSync(WORK, { recursive: true });

const settings = JSON.parse(readFileSync(join(PKG, 'testdata', 'default-settings.json'), 'utf8'));
if (typeof settings.smartBeat === 'boolean') settings.smartBeat = { enabled: settings.smartBeat, effects: {} };
const base = { ...settings, transparentPlayerBackground: true, mousePassthrough: false };
const queue = { mode: 'circle', random: false, index: 0, items: [{ id: 'q1', title: 'Two to Tango 交缠舞步', artist: 'A', album: 'X' }] };
const track = { id: 'q1', title: 'Two to Tango 交缠舞步', artist: 'A', album: 'X', durationMs: 16000 };
const lyrics = { lines: [{ startMs: 0, endMs: 16000, main: 'line one', sub: '一', cells: [] }], offsetMs: 0 };

const child = spawn(exe, [
    '--bundle', join(PKG, 'web'),
    '--settings-dir', join(PKG, 'web', 'settings'),
    '--settings-entry', 'settings-ui.js',
    '--fullscreen',
    '--user-data-dir', join(WORK, 'webview2-userdata'),
    '--fps-log', join(WORK, 'fps.log'),
], { cwd: PKG, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => { });
child.stderr.on('data', () => { });

const send = (o) => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch { /* host gone */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = {};
const tags = [];
const checks = [];
const assert = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
};
const evalJs = (tag, script) => { tags.push(tag); send({ t: 'command', command: 'eval', script }); };
const screenshot = (name) => send({ t: 'command', command: 'screenshot', path: join(WORK, name + '.png') });

// real cursor helper: prints "<screenW> x <screenH>", physical pixels
const cursorScript = join(HERE, 'win-cursor.ps1');
let screen = { w: 0, h: 0 };
const moveReal = (x, y) => {
    const r = spawnSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cursorScript, '-X', String(Math.round(x)), '-Y', String(Math.round(y))], { encoding: 'utf8' });
    const m = /(\d+)\s*x\s*(\d+)/.exec(String(r.stdout || ''));
    if (m) screen = { w: Number(m[1]), h: Number(m[2]) };
};

const PROBE = `(() => {
  const el = document.querySelector('.spw-playback');
  const r = el && el.getBoundingClientRect();
  return JSON.stringify({
    vw: window.innerWidth, vh: window.innerHeight,
    expanded: el && el.dataset.expanded, hidden: el && el.dataset.hidden, flat: el && el.dataset.flat,
    r: r && { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
  });
})()`;
const PANEL = `(() => {
  const panel = document.querySelector('.spw-player-bg-panel');
  const rows = panel ? panel.querySelectorAll('.spw-player-bg-row').length : 0;
  const hints = document.querySelectorAll('.spw-player-bg-hint').length;
  const notes = document.querySelectorAll('.spw-player-bg-note').length;
  return JSON.stringify({ rows, hints, notes });
})()`;

let buf = '';
let started = false;
let stateTimer = null;
let probe = null;

function hms(ms) { const t = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }

async function run() {
    await sleep(500);
    evalJs('panel', PANEL); await sleep(250);
    moveReal(400, 500); await sleep(400);
    evalJs('probe', PROBE); await sleep(250);
    const p = results.probe || {};
    const vw = p.vw || 1600, vh = p.vh || 900;
    const scaleX = screen.w ? screen.w / vw : 1;
    const scaleY = screen.h ? screen.h / vh : 1;
    const hudX = vw / 2;
    const hudY = vh - 28 - 48; // bottom offset 28 + half of the collapsed pill height
    const toPhysical = (cssX, cssY) => ({ x: cssX * scaleX, y: cssY * scaleY });

    // 1) hover the collapsed pill -> expand
    moveReal(toPhysical(hudX, hudY).x, toPhysical(hudX, hudY).y); await sleep(750);
    evalJs('hover', PROBE); await sleep(250);
    screenshot('transparent-hud-expanded');

    // 2) move away -> collapse
    moveReal(400 * scaleX, 500 * scaleY); await sleep(950);
    evalJs('away', PROBE); await sleep(250);

    // 3) idle -> slide out
    await sleep(3200);
    evalJs('idle', PROBE); await sleep(250);

    // 4) move back onto the pill -> wake + expand
    moveReal(toPhysical(hudX, hudY).x, toPhysical(hudX, hudY).y); await sleep(750);
    evalJs('wake', PROBE); await sleep(250);

    send({ t: 'quit' });
}

child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.t === 'ready') {
            if (started) continue;
            started = true;
            send({ t: 'hello', protocol: 1, pluginVersion: 'verify-transparent-hud', spwVersion: '1.19.0' });
            send({ t: 'settings', settings: base });
            send({ t: 'lyrics', ...lyrics });
            send({ t: 'track', ...track });
            send({ t: 'queue', ...queue });
            const anchor = Date.now();
            stateTimer = setInterval(() => send({
                t: 'state',
                posMs: (Date.now() - anchor) % 16000,
                durationMs: 16000,
                playing: true,
                rate: 1,
                tsMs: Date.now(),
            }), 100);
            run().catch((err) => console.error('flow error: ' + (err && err.message)));
        } else if (m.t === 'eval-result') {
            const tag = tags.shift() || '?';
            let v = m.value;
            for (let j = 0; j < 4 && typeof v === 'string'; j++) { try { v = JSON.parse(v); } catch { break; } }
            results[tag] = v;
        }
    }
});

child.on('exit', (code) => {
    clearInterval(stateTimer);
    const panel = results.panel || {};
    const hover = results.hover || {};
    const away = results.away || {};
    const idle = results.idle || {};
    const wake = results.wake || {};

    assert('panel: two switches, no hint/note copy', panel.rows === 2 && panel.hints === 0 && panel.notes === 0, panel);
    assert('transparent: bar rendered flat (data-flat=true)', hover.flat === 'true', { flat: hover.flat });
    assert('hover collapsed pill -> data-expanded=true', hover.expanded === 'true', hover.r || null);
    assert('move away -> data-expanded=false', away.expanded === 'false', away.r || null);
    assert('idle 3.2 s -> data-hidden=true', idle.hidden === 'true', idle.r || null);
    assert('move back -> wakes and expands', wake.hidden === 'false' && wake.expanded === 'true', wake.r || null);

    const failed = checks.filter((c) => !c.ok);
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && Object.keys(c.detail).length ? '  —  ' + JSON.stringify(c.detail) : ''}`);
    const report = { generatedAt: new Date().toISOString(), hostExitCode: code, checks, results, screenshot: join(WORK, 'transparent-hud-expanded.png') };
    writeFileSync(join(OUT, 'verify-transparent-hud-report.json'), JSON.stringify(report, null, 2));
    console.log(`\n${checks.length - failed.length}/${checks.length} PASS  (report: packaging/out/verify-transparent-hud-report.json)`);
    process.exit(failed.length ? 1 : 0);
});

setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 45000).unref();
