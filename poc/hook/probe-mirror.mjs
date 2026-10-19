#!/usr/bin/env node
// Probe: can the injected settings script mirror the live Folia renderer canvases?
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const exe = resolve(root, 'poc/webview/host/build/spw-folia-host.exe');
const foliaBundle = resolve(root, 'poc/webview/dist/dist');
const outDir = resolve(root, 'tmp-verify/mirror-probe');
mkdirSync(outDir, { recursive: true });

const SETTINGS = JSON.parse(readFileSync(resolve(root, 'packaging/testdata/default-settings.json'), 'utf8'));
const DEBUG_SCRIPT = '(function(){ var c=document.getElementsByTagName("canvas"); return JSON.stringify({href:location.href, ready:document.readyState, canvases:c.length, bodyChildren:document.body?document.body.children.length:0, hasFolia:!!window.__SPW_FOLIA__, hasShim:!!window.__SPW_FOLIA__, visualizerRoots:document.querySelectorAll("[data-visualizer-background]").length, html:document.body?document.body.innerHTML.slice(0,300):"" }); })()';

const LINES = [
    { startMs: 0, endMs: 4000, main: '光が満ちて', sub: 'light overflows', cells: [{ startMs: 0, endMs: 2000, text: '光が' }, { startMs: 2000, endMs: 4000, text: '満ちて' }] },
    { startMs: 4000, endMs: 8000, main: '君の声が', sub: 'your voice', cells: [{ startMs: 4000, endMs: 6000, text: '君の' }, { startMs: 6000, endMs: 8000, text: '声が' }] },
];

const MIRROR_SCRIPT = [
    '(function(){',
    '  var all = Array.prototype.slice.call(document.querySelectorAll("canvas"));',
    '  var list = all.map(function(c){',
    '    var r = c.getBoundingClientRect();',
    '    return { inside: !!c.closest("[data-spw-settings-ui]"), w: c.width, h: c.height, cw: Math.round(r.width), ch: Math.round(r.height), cls: (c.className||"").toString().slice(0,60) };',
    '  });',
    '  var out = [];',
    '  var live = all.filter(function(c){ return !c.closest("[data-spw-settings-ui]"); });',
    '  for (var i = 0; i < live.length && i < 6; i++) {',
    '    var c = live[i];',
    '    try {',
    '      var tw = Math.min(c.width || 1, 64), th = Math.min(c.height || 1, 64);',
    '      var tmp = document.createElement("canvas");',
    '      tmp.width = tw; tmp.height = th;',
    '      var ctx = tmp.getContext("2d");',
    '      ctx.drawImage(c, 0, 0, tw, th);',
    '      var data = ctx.getImageData(0, 0, tw, th).data;',
    '      var nonBlack = 0, sum = 0;',
    '      for (var p = 0; p < data.length; p += 4) {',
    '        var v = data[p] + data[p+1] + data[p+2];',
    '        if (v > 12) nonBlack++;',
    '        sum += v;',
    '      }',
    '      out.push({ i: i, readable: nonBlack > 20, nonBlack: nonBlack, total: (data.length/4), mean: Math.round(sum / (data.length/4)) });',
    '    } catch (e) { out.push({ i: i, error: String(e).slice(0,120) }); }',
    '  }',
    '  return JSON.stringify({ canvases: list, samples: out });',
    '})()',
].join('\n');

const run = () => new Promise((resolveRun) => {
    const evals = [];
    const results = { steps: [] };
    const child = spawn(exe, [
        '--bundle', foliaBundle, '--window', '1600x1000', '--force-dsf', '1', '--bundle-version', '0.1.4',
        '--settings-dir', resolve(root, 'poc/settings-ui/dist'), '--settings-entry', 'settings-ui.js',
    ], { cwd: root, windowsHide: false });
    child.stdin.on('error', () => {});
    const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };
    const evalJs = (script) => new Promise((res) => { evals.push(res); send({ t: 'command', command: 'eval', script }); });

    let done = false;
    const finish = async () => {
        if (done) return; done = true;
        writeFileSync(resolve(outDir, 'mirror-report.json'), JSON.stringify(results, null, 2));
        try { send({ t: 'command', command: 'quit' }); } catch {}
        await delay(500);
        try { child.kill(); } catch {}
        console.log('report:', resolve(outDir, 'mirror-report.json'));
        resolveRun(results);
    };

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
        let msg; try { msg = JSON.parse(line.trim()); } catch { return; }
        if (!/^\{/.test(line.trim())) console.log('[host]', line.trim().slice(0, 300));
        if (msg.t === 'ready') {
            send({ t: 'hello', protocol: 1, pluginVersion: 'probe', spwVersion: '1.19.0', bundleVersion: '0.1.4' });
            send({ t: 'settings', settings: SETTINGS });
            send({ t: 'lyrics', lines: LINES, offsetMs: 0 });
            send({ t: 'state', posMs: 1200, durationMs: 120000, playing: true, rate: 1, tsMs: Date.now() });
            const tick = setInterval(() => send({ t: 'state', posMs: 1200 + (Date.now() % 60000), durationMs: 120000, playing: true, rate: 1, tsMs: Date.now() }), 100);
            setTimeout(() => clearInterval(tick), 14000);
        } else if (msg.t === 'eval-result') {
            const res = evals.shift(); if (res) res(msg.value);
        }
    });

    (async () => {
        await delay(2500);
        results.debug = safeParse(await evalJs(DEBUG_SCRIPT));
        await delay(2500);
        const v1 = await evalJs(MIRROR_SCRIPT);
        results.steps.push({ tag: 'mirror', value: safeParse(v1) });
        await delay(700);
        const v2 = await evalJs(MIRROR_SCRIPT);
        results.steps.push({ tag: 'mirror2', value: safeParse(v2) });
        await finish();
    })().catch(async (e) => { results.error = String(e); await finish(); });
});

function safeParse(v) {
    if (typeof v !== 'string') return { raw: v };
    try { return JSON.parse(v); } catch { return { raw: v.slice(0, 400) }; }
}

run().then(() => process.exit(0));
