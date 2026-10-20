#!/usr/bin/env node
// v0.1.11 regression: load the real Folia OBS page + a Shim-shaped bridge stub + the built settings-UI
// bundle, then drive the settings round trip and assert what the page actually publishes.
//
// 1. compatibility table plumbing: `data-compat`, disabled switch, compat note, `data-spw-transparent`
// 2. transparent tuning overrides: config.visualizerTunings.<style> carries the transparent patch
// 3. auto-off: selecting an unsupported style while transparent must clear the setting and round-trip
// 4. still: the injected CSS rule hides the radial-gradient vignette on the live page
//
// Usage: node compat-regression.mjs [--entry settings-ui.js] [--port 18087] [--out out/]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const entry = opt('entry', 'settings-ui.js');
const port = Number(opt('port', '18087'));
const outDir = resolve(here, opt('out', 'out'));
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, [join(here, 'server.mjs'), String(port)], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });
await new Promise((r) => setTimeout(r, 1200));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 400)));

// Shim-shaped bridge stub: records pushed configs and every setSettings the bundle emits.
await page.addInitScript(() => {
  const handlers = new Map();
  const api = {
    protocol: 1,
    version: 'compat-regression',
    settings: { version: 1, styleId: 'sonnet' },
    lastConfig: null,
    setSettingsCalls: [],
    inputs: { state: null, lyrics: null, track: null },
    on(type, fn) { const list = handlers.get(type) || []; list.push(fn); handlers.set(type, list); return () => api.off(type, fn); },
    off(type, fn) { const list = handlers.get(type) || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); },
    emit() {},
    getSettings() { return api.settings; },
    setSettings(partial) { api.settings = Object.assign({}, api.settings, partial || {}); api.setSettingsCalls.push(partial); },
    pushConfig(config) { api.lastConfig = config; api.deliver('config', config); },
    getStats() { return {}; },
    requestClose() {},
    deliver(type, payload) { for (const fn of handlers.get(type) || []) { try { fn(payload); } catch (e) { console.error('[regression-bridge] handler error', type, e && e.message); } } },
    handlers,
  };
  window.__SPW_FOLIA__ = api;
});
await page.addInitScript(() => {
  window.document.addEventListener('DOMContentLoaded', () => {});
});

await page.goto(`http://127.0.0.1:${port}/?obs=1&token=debug`, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.evaluate((e) => {
  const s = document.createElement('script');
  s.type = 'module';
  s.src = `/settings-ui/${e}`;
  s.onerror = () => console.error('[regression] settings-ui load error');
  document.head.appendChild(s);
}, entry);
await page.waitForTimeout(3500);

const snapshotBase = {
  version: 1,
  smartBeat: { enabled: true, effects: {} },
  styleTunings: {},
  backgroundMode: 'latent',
  backgroundTunings: {},
  commonBackground: { opacity: 0.75, useCoverColorBg: false, disableVignette: false, disableGeometricBackground: false },
  appearance: { fontStyle: 'sans', fontScale: 1, fontWeight: null, visualizerOpacity: 1, customFontFamily: null },
  subtitle: {},
  previewPlaceholderId: 'default',
  lyricMotion: 0.8,
  textureResolution: 1.5,
  mousePassthrough: false,
};

const results = {};

async function scenario(name, settings, probe) {
  await page.evaluate((s) => {
    window.__SPW_FOLIA__.setSettingsCalls.length = 0;
    window.__SPW_FOLIA__.deliver('settings', s);
  }, settings);
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => {
    const api = window.__SPW_FOLIA__;
    const root = document.querySelector('.spw-player-bg');
    const config = api.lastConfig || {};
    const css = document.querySelector('style[data-spw-settings-ui-css]');
    return {
      dataset: { ...document.documentElement.dataset },
      compat: root ? root.getAttribute('data-compat') : null,
      disabledAttr: (() => { const b = document.querySelector('.spw-player-bg-row'); return b ? b.getAttribute('disabled') : null; })(),
      dataDisabled: (() => { const b = document.querySelector('.spw-player-bg-row'); return b ? b.getAttribute('data-disabled') : null; })(),
      lastConfig: {
        visualizerMode: config.visualizerMode,
        tunings: config.visualizerTunings || null,
        transparent: config.background ? config.background.transparent : null,
      },
      setSettingsCalls: api.setSettingsCalls.slice(-4),
      bridgeSettings: { styleId: api.settings.styleId, transparent: api.settings.transparentPlayerBackground, passthrough: api.settings.mousePassthrough },
      cssHasStillRule: css ? /visualizer-still.*radial-gradient/.test(css.textContent) : false,
    };
  });
  const extra = probe ? await probe() : null;
  results[name] = { state, extra };
  return results[name];
}

// --- 1. tempera: tuned, patch flows into the published config
await scenario('tempera-transparent', {
  ...snapshotBase,
  styleId: 'tempera',
  transparentPlayerBackground: true,
  styleTunings: { tempera: { showBlocks: true, postProcessVignette: 0.85, postProcessGrain: 0.2, textInversion: true } },
});

// --- 2. lumiere (dark theme): tuned, darkField 0 + textOnly
await scenario('lumiere-transparent', { ...snapshotBase, styleId: 'lumiere', transparentPlayerBackground: true });

// --- 3. pendolo: tuned, center gradient off
await scenario('pendolo-transparent', { ...snapshotBase, styleId: 'pendolo', transparentPlayerBackground: true });

// --- 4. monet: unsupported => transparent auto-cleared, round trip reports it
await scenario('monet-selected-while-transparent', {
  ...snapshotBase,
  styleId: 'monet',
  transparentPlayerBackground: true,
  mousePassthrough: true,
});

// --- 5. sonnet: native => transparent stays on, no tuning patch
await scenario('sonnet-transparent', { ...snapshotBase, styleId: 'sonnet', transparentPlayerBackground: true });

// --- 6. still: the injected CSS rule must hide the real vignette on a still page. The page's style
// comes from the SSE config, so this scenario needs its own page whose /obs/events request is
// rewritten to mode=still&transparent=1 (same trick transparency.mjs uses).
const stillPage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const stillErrors = [];
stillPage.on('pageerror', (e) => stillErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));
await stillPage.addInitScript(() => {
  const handlers = new Map();
  window.__SPW_FOLIA__ = {
    protocol: 1,
    settings: { version: 1, styleId: 'still', transparentPlayerBackground: true },
    inputs: { state: null, lyrics: null, track: null },
    on(type, fn) { const list = handlers.get(type) || []; list.push(fn); handlers.set(type, list); return () => {}; },
    emit() {},
    getSettings() { return this.settings; },
    setSettings() {},
    pushConfig() {},
    deliver(type, payload) { for (const fn of handlers.get(type) || []) fn(payload); },
    handlers,
  };
});
await stillPage.route('**/obs/events*', async (route) => {
  const u = new URL(route.request().url());
  u.searchParams.set('mode', 'still');
  u.searchParams.set('transparent', '1');
  await route.continue({ url: u.toString() });
});
await stillPage.goto(`http://127.0.0.1:${port}/?obs=1&token=debug`, { waitUntil: 'load', timeout: 30000 });
await stillPage.waitForTimeout(2500);
await stillPage.evaluate((e) => {
  const s = document.createElement('script');
  s.type = 'module';
  s.src = `/settings-ui/${e}`;
  document.head.appendChild(s);
}, entry);
await stillPage.waitForTimeout(3500);
const stillDom = await stillPage.evaluate(() => {
  const shell = document.querySelector('.visualizer-still');
  const vignette = shell ? shell.querySelector('div[class*="bg-[radial-gradient"]') : null;
  const textHost = shell
    ? [...shell.querySelectorAll('div')].find((el) => (el.className || '').toString().includes('flex-col') && (el.textContent || '').trim().length > 0)
    : null;
  return {
    shellFound: !!shell,
    vignetteFound: !!vignette,
    vignetteDisplay: vignette ? getComputedStyle(vignette).display : null,
    textHostFound: !!textHost,
    textSample: textHost ? (textHost.textContent || '').trim().slice(0, 40) : null,
    dataset: { ...document.documentElement.dataset },
    styleTagFound: !!document.querySelector('style[data-spw-settings-ui-css]'),
    cssHasStillRule: [...document.querySelectorAll('style')].some((el) => /visualizer-still.*radial-gradient/.test(el.textContent || '')),
  };
});
await stillPage.screenshot({ path: join(outDir, 'compat-regression-still-transparent.png'), omitBackground: true });

// Same page with transparency off: the rule must not match and the vignette must render again.
const stillOpaqueDom = await stillPage.evaluate(() => {
  document.documentElement.dataset.spwTransparent = 'false';
  const shell = document.querySelector('.visualizer-still');
  const vignette = shell ? shell.querySelector('div[class*="bg-[radial-gradient"]') : null;
  return { vignetteFound: !!vignette, vignetteDisplay: vignette ? getComputedStyle(vignette).display : null };
});
await stillPage.close();

// --- 9.5 hotkey path: the host calls window.__spwFoliaSetTransparent(true) on Ctrl+Alt+B, which
// bypasses the style-picker guard. With an unsupported style the store must refuse and push the
// corrected snapshot back, otherwise the host keeps the window colour-keyed (pink haze).
await scenario('hotkey-enable-on-monet', { ...snapshotBase, styleId: 'monet', transparentPlayerBackground: false });
await page.evaluate(() => {
  window.__SPW_FOLIA__.setSettingsCalls.length = 0;
  window.__spwFoliaSetTransparent(true);
});
await page.waitForTimeout(700);
results.hotkeyMonet = await page.evaluate(() => {
  const api = window.__SPW_FOLIA__;
  return {
    dataset: { ...document.documentElement.dataset },
    bridgeSettings: { transparent: api.settings.transparentPlayerBackground, passthrough: api.settings.mousePassthrough },
    setSettingsCalls: api.setSettingsCalls.slice(-4),
  };
});

// ... and on a native style the same call must actually switch transparency on.
await scenario('hotkey-enable-on-sonnet', { ...snapshotBase, styleId: 'sonnet', transparentPlayerBackground: false });
await page.evaluate(() => {
  window.__SPW_FOLIA__.setSettingsCalls.length = 0;
  window.__spwFoliaSetTransparent(true);
});
await page.waitForTimeout(700);
results.hotkeySonnet = await page.evaluate(() => {
  const api = window.__SPW_FOLIA__;
  return {
    dataset: { ...document.documentElement.dataset },
    bridgeSettings: { transparent: api.settings.transparentPlayerBackground },
    setSettingsCalls: api.setSettingsCalls.slice(-4),
  };
});

// --- 8. panel DOM: compat note + disabled styling for monet
await page.evaluate(() => {
  const api = window.__SPW_FOLIA__;
  api.deliver('settings', { ...api.settings, styleId: 'monet', transparentPlayerBackground: true });
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const btn = document.querySelector('.spw-chrome-btn--player');
  if (btn) btn.click();
});
await page.waitForTimeout(400);
results.panelMonet = await page.evaluate(() => {
  const note = document.querySelector('.spw-player-bg-note--compat');
  const row = document.querySelector('.spw-player-bg-row');
  return {
    noteText: note ? note.textContent : null,
    rowDisabled: row ? row.hasAttribute('disabled') : null,
    rowDataDisabled: row ? row.getAttribute('data-disabled') : null,
    rowOpacity: row ? getComputedStyle(row).opacity : null,
    rootCompat: (() => { const r = document.querySelector('.spw-player-bg'); return r ? r.getAttribute('data-compat') : null; })(),
  };
});
await page.screenshot({ path: join(outDir, 'compat-regression-panel.png') });

// --- 9. panel DOM for a tuned style while transparent (note should mention simplified decorations)
await page.evaluate(() => {
  const api = window.__SPW_FOLIA__;
  api.deliver('settings', { ...api.settings, styleId: 'tempera', transparentPlayerBackground: true });
});
await page.waitForTimeout(700);
results.panelTempera = await page.evaluate(() => {
  const note = document.querySelector('.spw-player-bg-note--compat');
  const row = document.querySelector('.spw-player-bg-row');
  return {
    noteText: note ? note.textContent : null,
    rowDisabled: row ? row.hasAttribute('disabled') : null,
    rootCompat: (() => { const r = document.querySelector('.spw-player-bg'); return r ? r.getAttribute('data-compat') : null; })(),
  };
});

results.consoleErrors = consoleErrors.slice(0, 20);
results.pageErrors = pageErrors.slice(0, 20);
results.serverLog = serverLog.slice(0, 1000);

// ---- verdicts
const v = {};
const tuningsOf = (r) => (r && r.state.lastConfig.tunings) || {};
v.temperaPatch = tuningsOf(results['tempera-transparent']).tempera;
v.lumierePatch = tuningsOf(results['lumiere-transparent']).lumiere;
v.pendoloPatch = tuningsOf(results['pendolo-transparent']).pendolo;
v.temperaPatched = !!v.temperaPatch && v.temperaPatch.showBlocks === false && v.temperaPatch.postProcessVignette === 0 && v.temperaPatch.postProcessGrain === 0;
v.lumierePatched = !!v.lumierePatch && v.lumierePatch.darkField === 0 && v.lumierePatch.textOnly === true;
v.pendoloPatched = !!v.pendoloPatch && v.pendoloPatch.showCenterGradient === false;
v.monetAutoCleared = results['monet-selected-while-transparent'].state.dataset.spwTransparent === 'false'
  && results['monet-selected-while-transparent'].state.bridgeSettings.transparent === false
  && results['monet-selected-while-transparent'].state.setSettingsCalls.some((c) => c && c.transparentPlayerBackground === false);
v.monetPassthroughCleared = results['monet-selected-while-transparent'].state.bridgeSettings.passthrough === false;
v.monetDisabled = results.panelMonet.rowDisabled === true && results.panelMonet.rootCompat === 'unsupported';
const sonnetTuning = tuningsOf(results['sonnet-transparent']).sonnet || {};
v.sonnetKeepsTransparent = results['sonnet-transparent'].state.dataset.spwTransparent === 'true'
  && results['sonnet-transparent'].state.lastConfig.transparent === true
  && !('showBlocks' in sonnetTuning) && !('darkField' in sonnetTuning) && !('showCenterGradient' in sonnetTuning);
v.stillVignetteHidden = stillDom.vignetteFound === true && stillDom.vignetteDisplay === 'none';
v.stillTextPreserved = stillDom.textHostFound === true;
v.stillRuleInCss = stillDom.styleTagFound === true && stillDom.cssHasStillRule === true;
v.stillOpaqueVignetteVisible = stillOpaqueDom.vignetteFound === true && stillOpaqueDom.vignetteDisplay !== 'none';
v.stillDatasetFlag = stillDom.dataset.spwTransparent === 'true';
v.tunedNote = typeof results.panelTempera.noteText === 'string' && results.panelTempera.noteText.includes('简化');
v.unsupportedNote = typeof results.panelMonet.noteText === 'string' && results.panelMonet.noteText.includes('无法');
// v0.1.11 hotkey guard: Ctrl+Alt+B on an unsupported style must be refused *and* reported back so
// the host drops the colour key; on a native style it must go through and round-trip.
v.hotkeyRefusedOnMonet = results.hotkeyMonet.bridgeSettings.transparent === false
  && results.hotkeyMonet.dataset.spwTransparent === 'false'
  && results.hotkeyMonet.setSettingsCalls.some((c) => c && c.transparentPlayerBackground === false);
v.hotkeyAllowedOnSonnet = results.hotkeySonnet.bridgeSettings.transparent === true
  && results.hotkeySonnet.dataset.spwTransparent === 'true'
  && results.hotkeySonnet.setSettingsCalls.some((c) => c && c.transparentPlayerBackground === true);

const report = { entry, verdicts: v, results };
writeFileSync(join(outDir, 'compat-regression.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdicts: v }, null, 2));
console.log('---');
console.log(JSON.stringify({
  temperaPatch: v.temperaPatch,
  lumierePatch: v.lumierePatch,
  pendoloPatch: v.pendoloPatch,
  monetPanel: results.panelMonet,
  temperaPanel: results.panelTempera,
  stillDom,
  stillOpaqueDom,
  stillErrors,
  consoleErrors: results.consoleErrors,
  pageErrors: results.pageErrors,
}, null, 2));

await browser.close();
server.kill();
process.exit(0);
