#!/usr/bin/env node
// Local verification for the m03207 changes (run after `npm run build` in poc/settings-ui):
//  1) settings overlay screenshots for the four tabs + removed A/B control assertions
//  2) font mapping proof: the page's pushed config.theme must carry fontStyle / fontWeight
//     (and subtitleTheme must follow the subtitle font switches).
// Usage: node poc/hook/verify-settings-v013.mjs [--out tmp-verify]
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
const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : resolve(root, 'tmp-verify');
mkdirSync(outDir, { recursive: true });

const baseSettings = JSON.parse(readFileSync(resolve(root, 'packaging/testdata/default-settings.json'), 'utf8'));
const withFonts = (fontStyle, fontWeight, extra = {}) => {
    const tree = JSON.parse(JSON.stringify(baseSettings));
    tree.appearance = { ...(tree.appearance || {}), fontStyle, fontWeight };
    Object.assign(tree, extra);
    return tree;
};
const serif = withFonts('serif', 700);
const mono = withFonts('mono', null);
const monoSubSerif = withFonts('mono', null, {
    subtitle: { ...(mono.subtitle || {}), subtitleFontInheritsLyrics: false, subtitleFontStyle: 'serif', subtitleFontWeight: 700 },
});

const LINES = [
    { startMs: 0, endMs: 4200, main: '字体测试', sub: 'font probe', cells: [{ startMs: 0, endMs: 2100, text: '字体' }, { startMs: 2100, endMs: 4200, text: '测试' }] },
    { startMs: 4200, endMs: 8400, main: '光が満ちて', sub: 'light overflows', cells: [{ startMs: 4200, endMs: 6300, text: '光が' }, { startMs: 6300, endMs: 8400, text: '満ちて' }] },
];

const ASSERT_SCRIPT = `(function(){
  var text = document.body ? document.body.innerText : '';
  var files = document.querySelectorAll('input[type="file"]').length;
  var tabs = Array.prototype.map.call(document.querySelectorAll('button'), function(b){ return (b.textContent||'').trim(); });
  var tab = function(name){ var b = Array.prototype.find.call(document.querySelectorAll('button'), function(x){ return (x.textContent||'').trim() === name; }); if (!b) return false; b.click(); return true; };
  return JSON.stringify({
    files: files,
    hasSmartBeat: text.indexOf('智能动感模式') >= 0,
    hasBeatEffects: text.indexOf('动感效果') >= 0,
    hasHarmony: text.indexOf('和声') >= 0,
    hasRomanization: text.indexOf('罗马音') >= 0,
    hasCustomFont: text.indexOf('自定义') >= 0,
    hasUrlBackground: text.indexOf('URL') >= 0,
    hasUploadText: text.indexOf('上传') >= 0,
    tabs: tabs.filter(function(t){ return t === '歌词动画' || t === '背景' || t === '字体' || t === '字幕'; }),
    hasSettingsRoot: !!document.querySelector('[data-spw-settings-ui]')
  });
})()`;

const TABS = [
    { name: '歌词动画', shot: 'tab-visualizer.png' },
    { name: '背景', shot: 'tab-background.png' },
    { name: '字体', shot: 'tab-font.png' },
    { name: '字幕', shot: 'tab-subtitle.png' },
];

const run = () => new Promise((resolveRun) => {
    const timeline = [];
    const evals = [];
    const results = { shots: {}, asserts: {}, configs: {} };
    const child = spawn(exe, [
        '--bundle', foliaBundle, '--window', '1600x1000', '--force-dsf', '1',
        '--bundle-version', '0.1.3',
        '--settings-dir', settingsDir, '--settings-entry', 'settings-ui.js',
    ], { cwd: root, windowsHide: false });
    child.stdin.on('error', () => { /* host closes stdin on shutdown */ });
    const send = (obj) => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* closed */ } };
    const evalJs = (script, tag) => new Promise((res) => {
        evals.push({ tag, res });
        send({ t: 'command', command: 'eval', script });
    });
    const screenshot = async (name) => {
        const path = resolve(outDir, name);
        send({ t: 'command', command: 'screenshot', path });
        results.shots[name] = path;
        await delay(650);
    };
    const rl = createInterface({ input: child.stdout });
    let ready = false, pump = null;
    rl.on('line', (line) => {
        timeline.push(line);
        if (!ready && line.includes('"t":"ready"')) {
            ready = true;
            send({ t: 'hello', protocol: 1, pluginVersion: '0.1.3', spwVersion: '1.19.0' });
            send({ t: 'settings', settings: serif });
            send({ t: 'lyrics', lines: LINES, offsetMs: 0 });
            send({ t: 'track', id: 'verify-v013', title: '字体测试', artist: 'probe', album: 'probe', durationMs: 8400 });
            pump = setInterval(() => {
                send({ t: 'state', posMs: 500 + Date.now() % 7000, durationMs: 8400, playing: true, rate: 1, tsMs: Date.now() });
            }, 100);
            void (async () => {
                await delay(1500);
                await evalJs('(function(){var api=window.__SPW_FOLIA__;if(!api)return "no-api";window.__cfg=window.__cfg||null;var o=api.pushConfig.bind(api);api.pushConfig=function(c){window.__cfg=c;return o(c);};return "wrapped";})()', 'wrap');
                await delay(400);
                send({ t: 'settings', settings: serif }); // same tree: force one republish through the wrapper
                await delay(800);
                results.configs.serif = await evalJs('(function(){var c=window.__cfg;return JSON.stringify({theme:c&&c.theme,sub:c&&c.subtitleTheme,contentMode:c&&c.subtitleContentMode,harmony:c&&c.showHarmonySubtitle});})()', 'config-serif');
                send({ t: 'settings', settings: mono });
                await delay(900);
                results.configs.mono = await evalJs('(function(){var c=window.__cfg;return JSON.stringify({theme:c&&c.theme,sub:c&&c.subtitleTheme});})()', 'config-mono');
                send({ t: 'settings', settings: monoSubSerif });
                await delay(900);
                results.configs.subSerif = await evalJs('(function(){var c=window.__cfg;return JSON.stringify({theme:c&&c.theme,sub:c&&c.subtitleTheme});})()', 'config-subserif');
                send({ t: 'command', command: 'open-settings' });
                await delay(900);
                for (const tab of TABS) {
                    const click = await evalJs(`(function(){var b=Array.prototype.find.call(document.querySelectorAll('button'),function(x){return (x.textContent||'').trim()===${JSON.stringify(tab.name)};});if(!b)return 'missing';b.click();return 'clicked';})()`, `tab-${tab.name}`);
                    results.asserts[`click-${tab.name}`] = click;
                    await delay(600);
                    await screenshot(tab.shot);
                    if (tab.name === '歌词动画' || tab.name === '字体' || tab.name === '字幕') {
                        results.asserts[`dom-${tab.name}`] = await evalJs(ASSERT_SCRIPT, `dom-${tab.name}`);
                    }
                }
                // style panels that used to carry upload controls: 凝彩 / 莫奈 / 群唱
                await evalJs(`(function(){var b=Array.prototype.find.call(document.querySelectorAll('button'),function(x){return (x.textContent||'').trim()==='歌词动画';});if(b)b.click();return 'visualizer';})()`, 'tab-back');
                await delay(600);
                for (const style of ['凝彩', '莫奈', '群唱']) {
                    const clicked = await evalJs(`(function(){var b=Array.prototype.find.call(document.querySelectorAll('button'),function(x){var name=(x.getAttribute('aria-label')||x.textContent||'').trim();return name===${JSON.stringify(style)};});if(!b)return 'missing';b.click();return 'clicked';})()`, `style-${style}`);
                    results.asserts[`click-${style}`] = clicked;
                    await delay(700);
                    results.asserts[`dom-${style}`] = await evalJs(ASSERT_SCRIPT, `dom-${style}`);
                    await screenshot(`style-${style}.png`);
                }
                send({ t: 'quit' });
            })();
        }
        // eval-result lines arrive as {"t":"eval-result","value":"<JSON-escaped string>"}
        if (line.includes('"t":"eval-result"') && evals.length > 0) {
            const pending = evals.shift();
            try {
                const parsed = JSON.parse(line);
                pending.res(parsed.value);
            } catch { pending.res(null); }
        }
    });
    child.on('exit', (code) => {
        if (pump) clearInterval(pump);
        const title = `verify-v013`;
        writeFileSync(resolve(outDir, `${title}-log.jsonl`), timeline.join('\n') + '\n');
        writeFileSync(resolve(outDir, `${title}-report.json`), JSON.stringify({ code, results }, null, 2));
        resolveRun({ code, results, log: resolve(outDir, `${title}-log.jsonl`) });
    });
    setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 45000);
});

const out = await run();
console.log(JSON.stringify({
    code: out.code,
    configs: out.results.configs,
    asserts: out.results.asserts,
    shots: out.results.shots,
}, null, 2));
