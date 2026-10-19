#!/usr/bin/env node
// Probe: does the big style preview follow the selected style in the settings overlay?
// Runs the local host with the real Folia bundle + settings island, opens the settings panel,
// then repeatedly clicks style shelf tiles via DOM and records the stage <img> srcs.
// Usage: node poc/hook/probe-style-preview.mjs [--out tmp-verify/preview-probe]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const exe = resolve(root, 'poc/webview/host/build/spw-folia-host.exe');
const foliaBundle = resolve(root, 'poc/webview/dist/dist');
const settingsDir = resolve(root, 'poc/settings-ui/dist');
const outArg = process.argv.indexOf('--out');
const outDir = outArg >= 0 ? resolve(process.argv[outArg + 1]) : resolve(root, 'tmp-verify/preview-probe');
mkdirSync(outDir, { recursive: true });

const settings = JSON.parse(readFileSync(resolve(root, 'packaging/testdata/default-settings.json'), 'utf8'));
const LINES = [
    { startMs: 0, endMs: 4200, main: '君の声が', sub: '你的声音', cells: [{ startMs: 0, endMs: 2100, text: '君の' }, { startMs: 2100, endMs: 4200, text: '声が' }] },
];

const SNAPSHOT = `(function(){
  var stage = document.querySelector('[data-spw-settings-ui] [class*="rounded-xl"]');
  var imgs = Array.prototype.map.call(document.querySelectorAll('[data-spw-settings-ui] img'), function(im){
    var r = im.getBoundingClientRect();
    return { src: im.getAttribute('src'), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), opacity: getComputedStyle(im).opacity };
  });
  var selected = document.querySelector('[data-spw-settings-ui] [aria-checked="true"], [data-spw-settings-ui] [aria-selected="true"]');
  return JSON.stringify({ imgs: imgs, selectedLabel: selected ? (selected.textContent || '').trim() : null, stageFound: !!stage });
})()`;

const CLICK_STYLE = (label) => `(function(){
  var target = Array.prototype.find.call(document.querySelectorAll('[data-spw-settings-ui] button, [data-spw-settings-ui] [role="radio"]'), function(el){
    return (el.textContent || '').trim() === ${JSON.stringify(label)};
  });
  if (!target) return JSON.stringify({ clicked: false, label: ${JSON.stringify(label)}, known: Array.prototype.map.call(document.querySelectorAll('[data-spw-settings-ui] button'), function(b){ return (b.textContent||'').trim(); }).filter(Boolean).slice(0, 40) });
  target.click();
  return JSON.stringify({ clicked: true, label: ${JSON.stringify(label)} });
})()`;

const run = () => new Promise((resolveRun) => {
  const evals = [];
  const results = { steps: [], shots: {} };
  const child = spawn(exe, [
    '--bundle', foliaBundle, '--window', '1600x1000', '--force-dsf', '1',
    '--bundle-version', '0.1.3', '--settings-dir', settingsDir, '--settings-entry', 'settings-ui.js',
  ], { cwd: root, windowsHide: false });
  child.stdin.on('error', () => {});
  const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };
  const evalJs = (script, tag) => new Promise((res) => { evals.push({ tag, res }); send({ t: 'command', command: 'eval', script }); });
  const shot = (path) => send({ t: 'command', command: 'screenshot', path });

  const finish = async () => {
    const reportPath = resolve(outDir, 'preview-report.json');
    writeFileSync(reportPath, JSON.stringify(results, null, 2));
    send({ t: 'command', command: 'quit' });
    await delay(400);
    child.kill();
    console.log('report:', reportPath);
    resolveRun(results);
  };

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text.startsWith('{')) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.t === 'ready') {
      send({ t: 'hello', protocol: 1, pluginVersion: 'probe', spwVersion: '1.19.0', bundleVersion: '0.1.3' });
      send({ t: 'settings', settings });
      send({ t: 'lyrics', lines: LINES, offsetMs: 0 });
      send({ t: 'state', posMs: 1200, durationMs: 120000, playing: true, rate: 1, tsMs: Date.now() });
      setTimeout(() => send({ t: 'command', command: 'open-settings' }), 400);
    } else if (msg.t === 'eval-result') {
      const pending = evals.shift();
      if (!pending) return;
      try { pending.res(msg.value); } catch { pending.res(null); }
    }
  });

  (async () => {
    await delay(3000);
    results.steps.push({ tag: 'initial', value: JSON.parse(await evalJs(SNAPSHOT, 'initial') || '{}') });
    shot(resolve(outDir, 'preview-initial.png'));
    for (const label of ['商籁', '凝彩', '莫奈', '时计', '群唱', '静止']) {
      const click = await evalJs(CLICK_STYLE(label), 'click-' + label);
      await delay(600);
      const snap = await evalJs(SNAPSHOT, 'snap-' + label);
      results.steps.push({ tag: label, click: JSON.parse(click || '{}'), snap: JSON.parse(snap || '{}') });
      shot(resolve(outDir, 'preview-' + label + '.png'));
      await delay(200);
    }
    await finish();
  })().catch(async (err) => { results.error = String(err); await finish(); });
  child.on('exit', () => { /* ignore */ });
});

run().then(() => process.exit(0));
