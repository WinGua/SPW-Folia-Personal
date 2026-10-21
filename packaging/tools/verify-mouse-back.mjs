#!/usr/bin/env node
// Mouse side-button "back" acceptance for v0.3.0 (packaged helper + packaged web payload):
//   A. opaque window  — WebView2 delivers XBUTTON1 to the page; the injected shim turns DOM button 3
//      into `{type:'action',name:'close'}` and the host exits with reason "user";
//   B. transparent window — the transparent input catcher forwards WM_XBUTTON* to the WebView2 input
//      window, so the very same page handler fires and the host exits with reason "user";
//   C. XBUTTON2 ("forward") is not a back action: the window must stay open;
//   D. while the settings overlay is open the first back only closes the overlay (same ownership
//      rule as ESC); the second back exits.
// Real OS mouse events are used (user32 mouse_event through packaging/tools/win-cursor.ps1) so the
// test exercises the same path a physical mouse takes.
//
// Usage: node packaging/tools/verify-mouse-back.mjs
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = join(ROOT, 'packaging');
const OUT = join(PKG, 'out');
mkdirSync(OUT, { recursive: true });

const exe = join(PKG, 'native', 'spw-folia-host.exe');
const cursorPs1 = join(PKG, 'tools', 'win-cursor.ps1');
for (const p of [exe, cursorPs1, join(PKG, 'web', 'index.html'), join(PKG, 'web', 'settings', 'settings-ui.js')]) {
  if (!existsSync(p)) { console.error(`missing packaged file: ${p}\nrun: bash packaging/build-package.sh`); process.exit(2); }
}

const baseSettings = JSON.parse(readFileSync(join(PKG, 'testdata', 'default-settings.json'), 'utf8'));
if (typeof baseSettings.smartBeat === 'boolean') baseSettings.smartBeat = { enabled: baseSettings.smartBeat, effects: {} };

const REPORT = { startedAt: new Date().toISOString(), exe, scenarios: [], pass: false };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const unwrap = (value) => {
  let v = value;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

const cursorCenter = () => {
  const res = spawnSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cursorPs1, '-X', '960', '-Y', '540'], { encoding: 'utf8' });
  const m = /(\d+)\s*x\s*(\d+)/.exec(String(res.stdout || ''));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1920, h: 1080 };
};
const cursorPress = (x, y, button) => {
  const flag = button === 2 ? '-XButton2' : '-XButton1';
  return spawnSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cursorPs1, '-X', String(x), '-Y', String(y), flag], { encoding: 'utf8' });
};

function runScenario(name, opts) {
  return new Promise((resolve) => {
    const userData = join(OUT, `webview2-mouseback-${name}`);
    const args = [
      '--bundle', join(PKG, 'web'),
      '--settings-dir', join(PKG, 'web', 'settings'),
      '--settings-entry', 'settings-ui.js',
      '--window', opts.window || '1280x800',
      '--user-data-dir', userData,
      '--fps-log', join(OUT, `mouseback-${name}-fps.log`),
    ];
    const child = spawn(exe, args, { cwd: PKG, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* gone */ } };
    const result = { name, transparent: !!opts.transparent, press: opts.press || 'XButton1', closed: null, exitCode: null, aliveAfterFirst: null, overlayClosed: null, geometry: null, evalResults: [], consoleErrors: 0, checks: {}, pass: false };
    let ready = false;
    let buf = '';
    let stderr = '';
    let timer = null;
    let done = false;
    const finish = () => { if (timer) { clearTimeout(timer); timer = null; } if (child.exitCode === null) { try { child.kill(); } catch { /* gone */ } } if (!done) { done = true; resolve(result); } };
    const geometry = () => {
      const m = /bounds=(-?\d+),(-?\d+) (\d+)x(\d+)/.exec(result.hostGeometryLine || '');
      return m ? { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) } : null;
    };

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const t = msg.t;
        if (t === 'ready') { ready = true; startFlow(); }
        else if (t === 'closed') result.closed = msg;
        else if (t === 'eval-result') result.evalResults.push(unwrap(msg.value));
        else if (t === 'log') {
          const text = String(msg.msg || '');
          if (msg.level === 'error' || text.includes('console:') || text.includes('js:') || text.includes('rejection:')) result.consoleErrors++;
          if (text.includes('geometry reason=')) result.hostGeometryLine = text;
          if (text.includes('transparency mode=on')) result.sawTransparencyOn = true;
          if (text.includes('transparency mode=off')) result.sawTransparencyOff = true;
        }
      }
    });

    const settings = { ...baseSettings };
    if (opts.transparent) settings.transparentPlayerBackground = true; else settings.transparentPlayerBackground = false;
    settings.mousePassthrough = false;

    const startFlow = () => {
      setTimeout(() => {
        send({ t: 'hello', protocol: 1, pluginVersion: '0.3.0', spwVersion: '1.19.0' });
        send({ t: 'settings', settings });
        send({ t: 'state', posMs: 2000, durationMs: 180000, playing: true, rate: 1, tsMs: Date.now() });
      }, 400);
      if (opts.openSettings) setTimeout(() => send({ t: 'command', command: 'open-settings' }), 1100);
      setTimeout(() => pressFirst(), opts.transparent ? 2000 : 1500);
    };

    const pressFirst = () => {
      const screen = cursorCenter();
      const g = geometry();
      const x = g ? g.x + Math.floor(g.w / 2) : Math.floor(screen.w / 2);
      const y = g ? g.y + Math.floor(g.h / 2) : Math.floor(screen.h / 2);
      result.geometry = g;
      result.cursor = { x, y };
      cursorPress(x, y, opts.press === 'XButton2' ? 2 : 1);
      result.pressedFirstAt = Date.now();
      setTimeout(afterFirst, opts.graceAfterFirst || 2500);
    };

    const afterFirst = () => {
      result.aliveAfterFirst = child.exitCode === null;
      result.stayedAliveAtFirst = !!result.aliveAfterFirst && !result.closed;
      if (opts.expectNoClose) {
        // Negative case: the forward side button must not exit; close the host ourselves.
        result.stayedAliveBeforeQuit = !!result.aliveAfterFirst && !result.closed;
        send({ t: 'quit' });
        setTimeout(finalize, 1800);
        return;
      }
      if (opts.checkOverlay) {
        result.evalResults.push(undefined);
        const probe = "JSON.stringify({open: !!(window.__SPW_FOLIA__ && window.__SPW_FOLIA__.ui && window.__SPW_FOLIA__.ui.isSettingsOpen && window.__SPW_FOLIA__.ui.isSettingsOpen())})";
        send({ t: 'command', command: 'eval', script: probe });
        setTimeout(() => {
          const last = result.evalResults.filter((v) => v !== undefined).pop();
          result.overlayClosed = last ? last.open === false : null;
          if (opts.pressAgainIfAlive && child.exitCode === null) {
            cursorPress(result.cursor.x, result.cursor.y, 1);
            setTimeout(afterSecond, 3000);
          } else finalize();
        }, 900);
      } else if (opts.pressAgainIfAlive && child.exitCode === null) {
        cursorPress(result.cursor.x, result.cursor.y, 1);
        setTimeout(afterSecond, 3000);
      } else finalize();
    };

    const afterSecond = () => {
      result.aliveAfterSecond = child.exitCode === null;
      finalize();
    };

    const finalize = () => {
      if (done) return;
      const closedUser = !!(result.closed && result.closed.reason === 'user');
      const closedPlugin = !!(result.closed && result.closed.reason === 'plugin');
      result.checks = {
        ready,
        geometryKnown: !!result.geometry,
        noConsoleErrors: result.consoleErrors === 0,
      };
      if (opts.transparent) result.checks.transparencyApplied = !!result.sawTransparencyOn;
      if (opts.expectNoClose) {
        result.checks.stayedAlive = !!result.stayedAliveBeforeQuit;
        result.checks.closedByQuit = closedPlugin;
        result.checks.exitedZero = result.exitCode === 0;
      } else {
        result.checks.closedUser = closedUser;
        result.checks.exitedZero = result.exitCode === 0;
        if (opts.expectAliveAfterFirst) result.checks.stayedAlive = !!result.stayedAliveAtFirst;
        if (opts.checkOverlay) result.checks.overlayClosedFirst = result.overlayClosed === true;
        if (opts.pressAgainIfAlive) result.checks.secondPressExited = closedUser && !result.aliveAfterSecond;
      }
      result.pass = Object.values(result.checks).every(Boolean);
      REPORT.scenarios.push(result);
      finish();
    };

    timer = setTimeout(() => {
      result.checks.timeout = false;
      result.pass = false;
      if (!done) REPORT.scenarios.push(result);
      finish();
    }, 20000);

    child.on('exit', (code) => {
      result.exitCode = code;
      // Give the stdout reader a beat to flush the trailing `closed` line.
      setTimeout(finalize, 250);
    });
  });
}

const scenarios = [
  ['opaque-back-exits', { transparent: false, press: 'XButton1' }],
  ['transparent-back-exits', { transparent: true, press: 'XButton1' }],
  ['forward-button-noop', { transparent: false, press: 'XButton2', expectNoClose: true, graceAfterFirst: 1800 }],
  ['settings-overlay-first', { transparent: false, press: 'XButton1', openSettings: true, expectAliveAfterFirst: true, checkOverlay: true, pressAgainIfAlive: true, graceAfterFirst: 1600 }],
];

for (const [name, opts] of scenarios) {
  process.stdout.write(`[mouse-back] ${name} ... `);
  const r = await runScenario(name, opts);
  console.log(r.pass ? 'PASS' : 'FAIL');
  if (!r.pass) console.log('   ', JSON.stringify(r.checks), 'closed=', r.closed, 'exit=', r.exitCode, 'alive1=', r.aliveAfterFirst, 'overlay=', r.overlayClosed);
  // A fresh WebView2 profile per run is isolated, but transient wins keep the pointer sane.
  await delay(300);
}

REPORT.pass = REPORT.scenarios.length === scenarios.length && REPORT.scenarios.every((s) => s.pass);
REPORT.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, 'verify-mouse-back-report.json'), JSON.stringify(REPORT, null, 2));
console.log(`[mouse-back] ${REPORT.pass ? 'PASS' : 'FAIL'} ${REPORT.scenarios.filter((s) => s.pass).length}/${REPORT.scenarios.length} -> ${join(OUT, 'verify-mouse-back-report.json')}`);
process.exit(REPORT.pass ? 0 : 1);
