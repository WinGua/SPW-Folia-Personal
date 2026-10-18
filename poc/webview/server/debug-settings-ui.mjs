#!/usr/bin/env node
// Debug harness: load the real Folia OBS page, install a minimal __SPW_FOLIA__ bridge stub (same
// shape as host Shim.js), then inject the settings-UI bundle (poc/settings-ui/dist) as a module
// script from the same origin (/settings-ui/...) and report console errors, DOM and bridge traffic.
//
// Usage: node debug-settings-ui.mjs [--entry settings-ui.js] [--out out/] [--port 18086]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
const port = Number(opt('port', '18086'));
const outDir = resolve(here, opt('out', 'out'));
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, [join(here, 'server.mjs'), String(port)], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });
await new Promise((r) => setTimeout(r, 1200));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleMsgs = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 400)));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));

// Bridge stub mirroring host Shim.js §3.3 surface (bounded, sync).
await page.addInitScript(() => {
  const handlers = new Map();
  const queue = [];
  const api = {
    protocol: 1,
    version: 'debug',
    settings: { styleId: 'sonnet', textureResolution: 1.5 },
    lastConfig: null,
    lastClock: null,
    inputs: null,
    on(type, fn) { const list = handlers.get(type) || []; list.push(fn); handlers.set(type, list); return () => api.off(type, fn); },
    off(type, fn) { const list = handlers.get(type) || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); },
    emit(type, payload) { window.chrome?.webview?.postMessage(JSON.stringify({ type, payload })); },
    getSettings() { return api.settings; },
    setSettings(partial) { api.settings = Object.assign({}, api.settings, partial || {}); },
    pushConfig(config) { api.lastConfig = config; },
    getStats() { return { canvases: document.querySelectorAll('canvas').length }; },
    requestClose() {},
    openSettings() { api.deliver('ui', { action: 'toggle-settings' }); },
    closeSettings() {},
    toggleSettings() {},
    deliver(type, payload) {
      const list = handlers.get(type) || [];
      if (!list.length) queue.push({ type, payload });
      for (const fn of list) { try { fn(payload); } catch (e) { console.error('[debug-bridge] handler error', type, e && e.message); } }
    },
    drain() { const q = queue.splice(0); for (const { type, payload } of q) api.deliver(type, payload); },
    handlers,
  };
  window.__SPW_FOLIA__ = api;
  window.__SPW_FOLIA_DEBUG__ = { queue, handlers };
});

await page.goto(`http://127.0.0.1:${port}/?obs=1&token=debug`, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

const before = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, bodyLen: document.body.innerText.length, hasApi: !!window.__SPW_FOLIA_SETTINGS_UI__ }));
await page.evaluate((e) => {
  const s = document.createElement('script');
  s.type = 'module';
  s.src = `/settings-ui/${e}`;
  s.onerror = () => console.error('[debug] settings-ui script load error');
  document.head.appendChild(s);
}, entry);
await page.waitForTimeout(4000);

// Deliver a settings message the way the host does, after the bundle had time to register.
await page.evaluate(() => {
  window.__SPW_FOLIA__.deliver('settings', { version: 1, styleId: 'sonnet', smartBeat: true, textureResolution: 1.5, lyricMotion: 0.8 });
  window.__SPW_FOLIA__.drain();
});
await page.waitForTimeout(1500);
await page.evaluate(() => window.__SPW_FOLIA__.openSettings());
await page.waitForTimeout(1200);

const after = await page.evaluate(() => {
  const roots = [...document.body.children].map((el) => `${el.tagName.toLowerCase()}#${el.id || ''}.${(el.className || '').toString().split(/\s+/).slice(0, 3).join('.')}`).slice(0, 12);
  return {
    hasSettingsApi: !!window.__SPW_FOLIA_SETTINGS_UI__,
    settingsApiKeys: window.__SPW_FOLIA_SETTINGS_UI__ ? Object.keys(window.__SPW_FOLIA_SETTINGS_UI__).slice(0, 20) : [],
    bodyLen: document.body.innerText.length,
    hasLyricsTab: /歌词动画/.test(document.body.innerText),
    hasStyleGrid: /样式/.test(document.body.innerText),
    bodySample: document.body.innerText.slice(0, 300),
    roots,
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(-8),
    handlers: window.__SPW_FOLIA_DEBUG__ ? [...window.__SPW_FOLIA_DEBUG__.handlers.keys()] : [],
    queued: window.__SPW_FOLIA_DEBUG__ ? window.__SPW_FOLIA_DEBUG__.queue.length : -1,
    canvases: document.querySelectorAll('canvas').length,
  };
});
await page.screenshot({ path: join(outDir, 'settings-ui-injected.png') });

const report = { entry, before, after, consoleMsgs, pageErrors, failedRequests: failedRequests.slice(0, 20), serverLog: serverLog.slice(0, 2000) };
writeFileSync(join(outDir, 'settings-ui-debug.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.kill();
process.exit(0);
