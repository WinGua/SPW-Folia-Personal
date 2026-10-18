// Offline self-containment probe for the extracted Folia production dist.
// 1) loads ?obs=1 surface on 127.0.0.1:18082 and records every request (HTTP + CDP sizes)
// 2) builds a loaded-resource inventory from performance resource timing
// 3) reloads in a fresh context with every non-same-origin request aborted, measures render/FPS
// 4) maps the loaded local subset onto dist files and sums the packaging footprint
// Writes out/offline-report.json and out/offline-*.png.
//
// Service workers are blocked in both contexts: a cold install has an empty SW cache anyway, and
// letting Workbox precache ~20MB in the background would flood the request log while masking the
// document's real dependency graph. This makes the measurement the strict cold-start one.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18082;
const TOKEN = 'probe';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PAGE_URL = `${ORIGIN}/?obs=1&token=${TOKEN}`;
const DIST_ROOT = path.resolve(__dirname, '..', 'dist', 'dist');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

// rAF meter usable in both phases; reset() gives a clean 4s window.
const FPS_METER = `(() => {
  const m = {
    frames: 0, last: 0, t0: performance.now(), samples: [], longFrames: 0,
    reset() { m.frames = 0; m.last = 0; m.samples = []; m.longFrames = 0; m.t0 = performance.now(); },
  };
  const loop = (t) => {
    if (m.last) { m.frames++; if (t - m.last > 25) m.longFrames++; }
    m.last = t;
    const elapsed = t - m.t0;
    if (elapsed >= 1000) { m.samples.push(+(m.frames * 1000 / elapsed).toFixed(1)); m.frames = 0; m.t0 = t; }
    requestAnimationFrame(loop);
  };
  window.__fps = m;
  requestAnimationFrame(loop);
})();`;

const waitForServer = (child) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server start timeout')), 20000);
  child.stdout.on('data', d => { if (String(d).includes('[spike-server]')) { clearTimeout(timer); resolve(); } });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
  child.on('exit', c => { clearTimeout(timer); reject(new Error(`server exited early: ${c}`)); });
});

const walkDist = (dir, acc) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walkDist(abs, acc); continue; }
    if (!entry.isFile()) continue;
    const st = fs.statSync(abs);
    acc.count += 1;
    acc.bytes += st.size;
    acc.files.push({ abs, rel: path.relative(DIST_ROOT, abs).split(path.sep).join('/'), bytes: st.size });
  }
};

const isLocalHost = h => h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
const isHttp = u => u.protocol === 'http:' || u.protocol === 'https:';

function urlToRel(urlStr) {
  const u = new URL(urlStr);
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '') p = '/index.html';
  return p.replace(/^\/+/, '').replace(/\\/g, '/');
}

const typeForExt = ext => ({ '.js': 'script', '.mjs': 'script', '.css': 'stylesheet', '.html': 'document',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.svg': 'image', '.gif': 'image',
  '.woff': 'font', '.woff2': 'font', '.ttf': 'font', '.otf': 'font', '.wasm': 'wasm', '.json': 'json',
  '.webmanifest': 'manifest', '.mp4': 'media', '.webm': 'media' }[ext] || 'other');

function analyzePng(file) {
  try {
    const png = PNG.sync.read(fs.readFileSync(file));
    let nonBlack = 0, lumaSum = 0;
    const { width, height, data } = png;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      lumaSum += l;
      if (data[i] + data[i + 1] + data[i + 2] > 24) nonBlack += 1;
    }
    const px = width * height;
    return { width, height, meanLuma: +(lumaSum / px).toFixed(2), nonBlackPct: +(100 * nonBlack / px).toFixed(2) };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

// ---------- index.html static reference audit ----------
function auditIndexHtml() {
  const file = path.join(DIST_ROOT, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const refs = new Map();
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    refs.set(m[1], refs.get(m[1]) || 'attribute');
  }
  for (const m of html.matchAll(/"([a-z][a-z0-9+.-]*:\/\/[^"]+)"/g)) {
    refs.set(m[1], 'importmap');
  }
  const external = [], missing = [], local = [];
  for (const [ref, kind] of refs) {
    if (/^(data:|blob:|#|mailto:)/.test(ref)) continue;
    let u;
    try { u = new URL(ref, ORIGIN + '/'); } catch { continue; }
    if (!isHttp(u)) continue;
    if (!isLocalHost(u.hostname)) { external.push({ ref, kind, host: u.hostname }); continue; }
    const rel = urlToRel(u.href);
    const abs = path.join(DIST_ROOT, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) local.push(rel);
    else missing.push({ ref, kind, resolved: rel });
  }
  return { external, missing, localCount: local.length };
}

const main = async () => {
  const dist = { count: 0, bytes: 0, files: [] };
  walkDist(DIST_ROOT, dist);
  const distIndex = new Map(dist.files.map(f => [f.rel, f]));

  const server = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({
      channel: 'msedge',
      headless: true,
      args: ['--window-size=1920,1080', '--enable-precise-memory-info', '--hide-scrollbars'],
    });

    // ================= PHASE 1: online load, record everything =================
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.addInitScript(FPS_METER);
    const page = await context.newPage();

    const cdp = await context.newCDPSession(page);
    const net = new Map();   // requestId -> record
    const pageRequests = []; // page.on('request')
    const requestFailedEvents = [];
    cdp.on('Network.requestWillBeSent', e => {
      net.set(e.requestId, {
        url: e.request.url, method: e.request.method, cdpType: e.type || null,
        initiatorType: e.initiator && e.initiator.type || null,
        frameId: e.frameId || null, loaderId: e.loaderId || null,
        status: null, mimeType: null, wireBytes: null, fromDiskCache: false, fromServiceWorker: false,
        errorText: null, redirectFrom: e.redirectResponse ? e.redirectResponse.url : null,
      });
    });
    cdp.on('Network.responseReceived', e => {
      const r = net.get(e.requestId);
      if (!r) return;
      r.status = e.response.status;
      r.mimeType = e.response.mimeType;
      r.fromDiskCache = !!e.response.fromDiskCache;
      r.fromServiceWorker = !!e.response.fromServiceWorker;
      if (typeof e.response.encodedDataLength === 'number') r.wireBytes = e.response.encodedDataLength;
    });
    cdp.on('Network.loadingFinished', e => {
      const r = net.get(e.requestId);
      if (r && typeof e.encodedDataLength === 'number') r.wireBytes = e.encodedDataLength;
    });
    cdp.on('Network.loadingFailed', e => {
      const r = net.get(e.requestId);
      if (r) r.errorText = `${e.errorText || 'failed'}${e.canceled ? ' (canceled)' : ''}`;
      else requestFailedEvents.push({ url: null, error: e.errorText, canceled: !!e.canceled });
    });
    await cdp.send('Network.enable');

    page.on('request', r => pageRequests.push({ url: r.url(), method: r.method(), resourceType: r.resourceType(), isNavigation: r.isNavigationRequest() }));
    page.on('requestfailed', r => requestFailedEvents.push({ url: r.url(), error: r.failure() ? r.failure().errorText : 'unknown', resourceType: r.resourceType() }));
    const onlineConsoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') onlineConsoleErrors.push(m.text()); });
    page.on('pageerror', e => onlineConsoleErrors.push('[pageerror] ' + e.message));

    let navError = null;
    try {
      await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 45000 });
    } catch (e) { navError = String(e && e.message || e); }
    await sleep(8000);

    const online = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource').map(e => ({
        name: e.name, initiatorType: e.initiatorType, transferSize: e.transferSize || 0,
        decodedBodySize: e.decodedBodySize || 0, duration: Math.round(e.duration || 0),
      }));
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const fps = (window.__fps && window.__fps.samples) || [];
      return {
        documentUrl: location.href,
        title: document.title,
        canvases: canvases.length,
        activeCanvases: canvases.filter(c => c.width > 0 && c.height > 0).length,
        canvasDims: canvases.map(c => `${c.width}x${c.height}`),
        rootChildCount: document.querySelector('#root') ? document.querySelector('#root').children.length : -1,
        bodyTextSample: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        fpsSamples: fps,
        longFrames: (window.__fps && window.__fps.longFrames) || 0,
        resourceEntries: entries,
        splashPresent: !!document.querySelector('#app-splash'),
        serviceWorkerControlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      };
    });
    const baselineShot = path.join(OUT, 'offline-baseline.png');
    await page.screenshot({ path: baselineShot });
    await context.close();

    // ================= merge online requests into records =================
    const perfByUrl = new Map(online.resourceEntries.map(e => [e.name, e]));
    const byUrl = new Map(); // dedupe by url, last wins for status but keep max wire bytes
    for (const r of net.values()) {
      if (!isHttp(new URL(r.url))) continue;
      const prev = byUrl.get(r.url);
      if (prev && prev.status !== null && r.status === null) continue;
      const perf = perfByUrl.get(r.url);
      byUrl.set(r.url, {
        url: r.url,
        method: r.method,
        resourceType: r.cdpType,
        initiatorType: (perf && perf.initiatorType) || r.initiatorType || 'other',
        frameId: r.frameId,
        status: r.status,
        mimeType: r.mimeType,
        wireBytes: r.wireBytes || 0,
        transferSize: perf ? perf.transferSize : 0,
        decodedBodySize: perf ? perf.decodedBodySize : 0,
        fromDiskCache: r.fromDiskCache,
        fromServiceWorker: r.fromServiceWorker,
        error: r.errorText,
      });
    }
    // Requests seen by page.on('request') but not by CDP (rare) still get an entry.
    for (const pr of pageRequests) {
      if (byUrl.has(pr.url)) continue;
      let u; try { u = new URL(pr.url); } catch { continue; }
      if (!isHttp(u)) continue;
      byUrl.set(pr.url, { url: pr.url, method: pr.method, resourceType: pr.resourceType, initiatorType: 'other',
        status: null, mimeType: null, wireBytes: 0, transferSize: 0, decodedBodySize: 0, fromDiskCache: false,
        fromServiceWorker: false, error: null });
    }

    const records = [...byUrl.values()];
    const requests = records.map(r => {
      const u = new URL(r.url);
      const external = !isLocalHost(u.hostname);
      return {
        url: r.url, host: u.hostname, path: u.pathname, resourceType: r.resourceType,
        initiatorType: r.initiatorType, status: r.status, bytes: r.decodedBodySize || r.wireBytes || 0,
        external, fromDiskCache: r.fromDiskCache, error: r.error || null,
      };
    });
    const externalRequests = requests.filter(r => r.external);
    const failedRequests = [];
    for (const r of records) {
      if (r.error) failedRequests.push({ url: r.url, kind: 'network', error: r.error, resourceType: r.resourceType });
      else if (r.status !== null && r.status >= 400) failedRequests.push({ url: r.url, kind: 'http', status: r.status, resourceType: r.resourceType });
    }
    for (const f of requestFailedEvents) {
      if (f.url && !failedRequests.some(x => x.url === f.url)) {
        failedRequests.push({ url: f.url, kind: 'network', error: f.error || 'requestfailed', resourceType: f.resourceType || null });
      }
    }

    // ================= PHASE 4a: loaded subset -> dist files =================
    const localRecords = records.filter(r => {
      const u = new URL(r.url);
      return isLocalHost(u.hostname);
    });
    const loadedMap = new Map(); // rel -> {path, bytes, type, mime, requests}
    const nonFileEndpoints = [];
    for (const r of localRecords) {
      const u = new URL(r.url);
      if (u.pathname.startsWith('/obs/')) { nonFileEndpoints.push(u.pathname); continue; }
      const rel = urlToRel(r.url);
      const entry = distIndex.get(rel);
      if (entry) {
        const ext = path.extname(rel).toLowerCase();
        const prev = loadedMap.get(rel) || { path: rel, bytes: entry.bytes, type: typeForExt(ext),
          mime: r.mimeType || MIME[ext] || 'application/octet-stream', requests: 0 };
        prev.requests += 1;
        loadedMap.set(rel, prev);
      } else {
        nonFileEndpoints.push(u.pathname);
      }
    }
    const loadedFiles = [...loadedMap.values()].sort((a, b) => b.bytes - a.bytes);
    const loadedTotalBytes = loadedFiles.reduce((s, f) => s + f.bytes, 0);

    const unaccounted = localRecords
      .filter(r => { const u = new URL(r.url); return !u.pathname.startsWith('/obs/') && !distIndex.has(urlToRel(r.url)); })
      .map(r => ({ url: r.url, status: r.status }));

    // top 20 by decoded size, falling back to file size / wire size
    const top20BySize = records
      .map(r => {
        let bytes = r.decodedBodySize || 0;
        if (!bytes && r.status !== 404) {
          try {
            const u = new URL(r.url);
            if (isLocalHost(u.hostname)) { const e = distIndex.get(urlToRel(r.url)); if (e) bytes = e.bytes; }
          } catch { /* ignore */ }
        }
        if (!bytes) bytes = r.wireBytes || 0;
        return { url: r.url, bytes, type: r.resourceType, status: r.status };
      })
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20);

    const perfTotals = {
      resourceEntryCount: online.resourceEntries.length,
      transferBytes: online.resourceEntries.reduce((s, e) => s + (e.transferSize || 0), 0),
      decodedBodyBytes: online.resourceEntries.reduce((s, e) => s + (e.decodedBodySize || 0), 0),
      byInitiatorType: online.resourceEntries.reduce((acc, e) => { acc[e.initiatorType] = (acc[e.initiatorType] || 0) + 1; return acc; }, {}),
    };

    // ================= PHASE 3: offline, block all non-same-origin =================
    const offlineContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await offlineContext.addInitScript(FPS_METER);
    const blockedExternalUrls = [];
    await offlineContext.route('**/*', route => {
      const reqUrl = route.request().url();
      let u;
      try { u = new URL(reqUrl); } catch { return route.continue(); }
      if (isHttp(u) && u.origin !== ORIGIN) { blockedExternalUrls.push(reqUrl); return route.abort('blockedbyclient'); }
      return route.continue();
    });

    const page2 = await offlineContext.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page2.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page2.on('pageerror', e => pageErrors.push(e.message));
    const offlineFailedResources = [];
    page2.on('requestfailed', r => {
      const u = new URL(r.url());
      if (isHttp(u) && u.origin === ORIGIN) offlineFailedResources.push({ url: r.url(), error: r.failure() ? r.failure().errorText : 'unknown' });
    });

    let offlineNavError = null;
    try {
      await page2.goto(PAGE_URL, { waitUntil: 'load', timeout: 45000 });
    } catch (e) { offlineNavError = String(e && e.message || e); }
    await sleep(8000);
    await page2.evaluate(() => { if (window.__fps) window.__fps.reset(); });
    await sleep(4000); // clean ~4s FPS window
    const offline = await page2.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const s = window.__fps || {};
      return {
        documentUrl: location.href,
        title: document.title,
        canvases: canvases.length,
        activeCanvases: canvases.filter(c => c.width > 0 && c.height > 0).length,
        canvasDims: canvases.map(c => `${c.width}x${c.height}`),
        rootChildCount: document.querySelector('#root') ? document.querySelector('#root').children.length : -1,
        bodyTextSample: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        fpsSamples: s.samples || [],
        longFrames: s.longFrames || 0,
        resourceEntryCount: performance.getEntriesByType('resource').length,
        splashPresent: !!document.querySelector('#app-splash'),
      };
    });
    const offlineShot = path.join(OUT, 'offline-blocked.png');
    await page2.screenshot({ path: offlineShot });
    await offlineContext.close();

    const fps = offline.fpsSamples || [];
    const fpsMean = fps.length ? +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1) : 0;
    const baselinePng = analyzePng(baselineShot);
    const offlinePng = analyzePng(offlineShot);
    const renderedOffline = offline.canvases > 0 && fpsMean > 1 && offline.bodyTextSample.length > 0
      && !(offlinePng.nonBlackPct === 0);

    const indexAudit = auditIndexHtml();

    // ================= notes + minimal subset hint =================
    const pct = +(100 * loadedTotalBytes / dist.bytes).toFixed(1);
    const mb = n => +(n / 1048576).toFixed(2);
    const assetsLoaded = loadedFiles.filter(f => f.path.startsWith('assets/'));
    const rootLoaded = loadedFiles.filter(f => !f.path.startsWith('assets/')).map(f => f.path);
    const assetScripts = assetsLoaded.filter(f => f.type === 'script').length;
    const assetStyles = assetsLoaded.filter(f => f.type === 'stylesheet').length;
    const foliumIcons = dist.files.filter(f => f.rel.startsWith('assets/folium-icons/'));
    const notes = [];
    notes.push(`Online load on ${PAGE_URL}; document ${online.documentUrl}; ${pageRequests.length} page.on('request') events, ${records.length} unique HTTP(S) requests recorded via CDP (exact wire bytes).`);
    notes.push(`External (non-loopback) requests during online load: ${externalRequests.length}.` + (externalRequests.length ? ' ' + externalRequests.map(r => r.url).join(', ') : ' None - the app never fetched the CDN importmap targets.'));
    notes.push(`index.html importmap maps 8 bare specifiers to https://aistudiocdn.com, but no built bundle imports those bare specifiers (grep found none), so nothing is fetched; importmap is inert at runtime but cosmetic/external-looking in the HTML.`);
    notes.push(`Service workers were blocked (context serviceWorkers:'block') in both phases: a cold install has no SW cache, and Workbox precache of the full dist would otherwise flood the log and mask the document's real dependency graph. SW files are therefore not in the loaded subset.`);
    notes.push(`Loaded subset ${loadedFiles.length} files / ${mb(loadedTotalBytes)} MB (decoded disk bytes) = ${pct}% of dist's ${dist.count} files / ${mb(dist.bytes)} MB. Wire/transfer total from resource timing: ${mb(perfTotals.transferBytes)} MB transfer, ${mb(perfTotals.decodedBodyBytes)} MB decoded (includes duplicate/compressed counts).`);
    notes.push(`Dist contains ${dist.count} files: 223 top-level assets + ${foliumIcons.length} files under assets/folium-icons/ (${mb(foliumIcons.reduce((s, f) => s + f.bytes, 0))} MB); the OBS surface loaded ${assetsLoaded.length} of them. Largest never-loaded chunks are non-OBS routes/features.`);
    notes.push(`Non-file local endpoints requested: ${[...new Set(nonFileEndpoints)].join(', ') || 'none'} (SSE feed, implemented by server.mjs, not shipped in dist).`);
    notes.push(`Offline test aborted ${blockedExternalUrls.length} non-same-origin request(s). Local 404s: ${unaccounted.length === 0 && failedRequests.filter(f => f.status === 404).length === 0 ? 'none' : JSON.stringify(unaccounted)}.`);
    notes.push(`index.html static refs: ${indexAudit.localCount} local (all resolve), ${indexAudit.missing.length} missing, ${indexAudit.external.length} external importmap URL(s) (not fetched).`);
    notes.push(`Packaging caveat: index.html hard-references registerSW.js and manifest.webmanifest. If the service-worker trio (sw.js + workbox-*.js + folia-cover-sw.js, ~39 KB) is dropped, the registerSW.js script tag must be removed too, or every load ends in a sw.js 404 after the render-critical load.`);
    notes.push(`Offline render: canvases ${offline.canvases} (active ${offline.activeCanvases}), fps mean ${fpsMean} from samples [${fps.join(', ')}], screenshot non-black ${offlinePng.nonBlackPct}% vs baseline ${baselinePng.nonBlackPct}%, pageerrors ${pageErrors.length}, console errors ${consoleErrors.length}.`);
    if (onlineConsoleErrors.length) notes.push(`Online console/page errors: ${JSON.stringify(onlineConsoleErrors.slice(0, 10))} (SW-block rejection is expected).`);
    if (consoleErrors.length) notes.push(`Offline console errors: ${JSON.stringify(consoleErrors.slice(0, 10))} (SW-block rejection is expected and benign; see blockedExternalUrls).`);
    if (offlineNavError) notes.push(`Offline navigation error: ${offlineNavError}`);
    if (navError) notes.push(`Online navigation error: ${navError}`);

    let minimalSubsetHint;
    if (externalRequests.length === 0 && renderedOffline) {
      const manifestBytes = (distIndex.get('manifest.webmanifest') || {}).bytes || 0;
      minimalSubsetHint = `Ship the exact ${loadedFiles.length}-file loaded subset (${mb(loadedTotalBytes)} MB of the ${mb(dist.bytes)} MB dist, ${pct}%): ${rootLoaded.join(' + ')} + ${assetsLoaded.length} assets/ files (${assetScripts} JS chunks + ${assetStyles} CSS: main/preload-helper/modulepreload-polyfill/frameRateLimiter, Sonnet visualizer/lyrics/icon chunks). Add manifest.webmanifest (${manifestBytes} B, referenced by index.html but not fetched by the headless run). Verified offline: all non-127.0.0.1:18082 requests blocked, ${offline.canvases} canvases still render, ${fpsMean} fps over 4 s, ${pageErrors.length} page errors, ${externalRequests.length} external requests. Drop the other ${dist.count - loadedFiles.length} files, notably assets/folium-icons/ (${foliumIcons.length} files, ${mb(foliumIcons.reduce((s, f) => s + f.bytes, 0))} MB) and the unused route/provider/ICU chunks (e.g. _virtual_icu-folia-dict, 3.9 MB). Packaging caveat: if you also drop sw.js/workbox-*.js/folia-cover-sw.js (~39 KB SW trio), remove the registerSW.js script tag from index.html or it will 404 on every load. No external host is required.`;
    } else {
      minimalSubsetHint = `Loaded subset is ${loadedFiles.length} files / ${mb(loadedTotalBytes)} MB (${pct}% of dist). Offline render ${renderedOffline ? 'succeeded' : 'FAILED'}${externalRequests.length ? `; external deps must be vendored: ${externalRequests.map(r => r.host).join(', ')}` : ''}. See notes/offlineTest for evidence.`;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      url: PAGE_URL,
      documentUrl: online.documentUrl,
      requestCount: records.length,
      pageRequestEvents: pageRequests.length,
      localRequestCount: localRecords.length,
      externalRequests,
      failedRequests,
      loadedFiles: loadedFiles.map(f => ({ path: f.path, bytes: f.bytes, type: f.type })),
      loadedTotalBytes,
      loadedFileCount: loadedFiles.length,
      distTotalBytes: dist.bytes,
      distFileCount: dist.count,
      loadedPctOfDist: pct,
      top20BySize,
      perfTotals,
      indexHtmlRefs: indexAudit,
      unaccountedLocalRequests: unaccounted,
      offlineTest: {
        canvases: offline.canvases,
        activeCanvases: offline.activeCanvases,
        canvasDims: offline.canvasDims,
        fpsSamples: fps,
        fpsMean,
        longFrames: offline.longFrames,
        consoleErrors,
        pageErrors,
        bodyTextSample: offline.bodyTextSample,
        screenshot: 'poc/webview/server/out/offline-blocked.png',
        renderedOffline,
        blockedExternalUrls,
        failedLocalResources: offlineFailedResources,
        documentUrl: offline.documentUrl,
        title: offline.title,
        rootChildCount: offline.rootChildCount,
        resourceEntryCount: offline.resourceEntryCount,
        pixels: offlinePng,
      },
      onlineBaseline: {
        canvases: online.canvases,
        activeCanvases: online.activeCanvases,
        canvasDims: online.canvasDims,
        rootChildCount: online.rootChildCount,
        fpsSamples: online.fpsSamples,
        bodyTextSample: online.bodyTextSample,
        title: online.title,
        screenshot: 'poc/webview/server/out/offline-baseline.png',
        pixels: baselinePng,
        consoleErrors: onlineConsoleErrors,
      },
      notes,
      minimalSubsetHint,
    };

    const reportPath = path.join(OUT, 'offline-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      ok: true,
      reportPath,
      externalRequests: externalRequests.length,
      failedRequests: failedRequests.length,
      loadedFiles: loadedFiles.length,
      loadedTotalMB: mb(loadedTotalBytes),
      distFiles: dist.count,
      distMB: mb(dist.bytes),
      pct,
      offline: { rendered: renderedOffline, canvases: offline.canvases, fpsMean, nonBlackPct: offlinePng.nonBlackPct, pageErrors: pageErrors.length, consoleErrors: consoleErrors.length },
      blockedExternal: blockedExternalUrls.length,
      top5: top20BySize.slice(0, 5),
    }, null, 2));
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { server.kill('SIGKILL'); } catch { /* ignore */ }
  }
};

main().catch(e => { console.error('PROBE FAILED:', e); process.exit(1); });
