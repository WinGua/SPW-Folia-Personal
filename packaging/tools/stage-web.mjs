#!/usr/bin/env node
// Stage the complete Folia web bundle (OBS browser-source surface) into packaging/web/.
//
// IMPORTANT: the full dist/ tree must be shipped, not just the files loaded during a cold
// offline run: Folia lazy-loads per-style chunks (e.g. assets/VisualizerTempera-*.js) via dynamic
// import(), and an incomplete subset caused a black fullscreen window for non-default styles
// (release-artifact bug found by task-13). We therefore copy every dist file except the
// service-worker/PWA trio (not shipped) and local backup files.
//
// Usage: node packaging/tools/stage-web.mjs [--dist <dir>] [--out <dir>]  (--report is optional/ignored)
import { existsSync, mkdirSync, copyFileSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const dist = resolve(ROOT, opt('dist', 'poc/webview/dist/dist'));
const out = resolve(ROOT, opt('out', 'packaging/web'));
const settingsSrc = resolve(ROOT, 'poc/settings-ui/dist');

if (!existsSync(dist)) throw new Error(`missing dist: ${dist}`);
if (!existsSync(settingsSrc)) throw new Error(`missing settings-UI dist: ${settingsSrc}`);

// Nothing from the PWA/service-worker layer is shipped (the host is a plain WebView2 page).
const skipFiles = new Set(['registerSW.js', 'sw.js', 'folia-cover-sw.js', 'manifest.webmanifest']);
const skipPatterns = [/^workbox-.*\.js$/, /^.*\.bak$/];

function walk(root, rel, acc) {
  for (const ent of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walk(root, r, acc);
    else if (!skipFiles.has(ent.name) && !skipPatterns.some((re) => re.test(ent.name))) acc.push(r);
  }
  return acc;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const wanted = walk(dist, '', []).sort();
let copied = 0;
let bytes = 0;
const missing = [];
const copiedList = [];
for (const rel of wanted) {
  const src = join(dist, rel);
  if (!existsSync(src) || !statSync(src).isFile()) { missing.push(rel); continue; }
  const dst = join(out, rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied++;
  bytes += statSync(dst).size;
  copiedList.push(rel);
  if (rel.startsWith('assets/') && /\.js$/.test(rel)) {
    // guard: lazy chunks must be included (task-13 regression)
    if (!existsSync(dst)) throw new Error(`failed to copy chunk ${rel}`);
  }
}
const hasLazyChunks = copiedList.some((r) => /^assets\/Visualizer/.test(r));
if (!hasLazyChunks) throw new Error('no per-style lazy chunks found in dist assets/ (incomplete dist?)');

// index.html is the only patched file: drop the PWA service-worker registration script (no SW is
// shipped, the tag would 404 on every load) and the manifest link (manifest not shipped).
const indexPath = join(out, 'index.html');
let html = readFileSync(indexPath, 'utf8');
const before = html;
html = html.replace(/<script[^>]*vite-plugin-pwa:register-sw[^>]*><\/script>/g, '');
html = html.replace(/\s*<link rel="manifest"[^>]*>/g, '');
html = html.replace(/\s*<script[^>]*src="\.\/registerSW\.js"[^>]*><\/script>/g, '');
if (html !== before) writeFileSync(indexPath, html);

// Settings UI island: served by the host at https://spw-folia-settings.local/ (bundle subdir
// settings/ is auto-detected by --bundle). Copy the whole dist (settings-ui.js + styles/ + assets/).
const settingsOut = join(out, 'settings');
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, ent.name);
    const d = join(dst, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else { copyFileSync(s, d); }
  }
}
copyTree(settingsSrc, settingsOut);
let settingsBytes = 0;
let settingsFiles = 0;
(function walk(p) {
  for (const ent of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, ent.name);
    if (ent.isDirectory()) walk(f);
    else { settingsFiles++; settingsBytes += statSync(f).size; }
  }
})(settingsOut);

// Host-injected scripts are embedded in the executable (C# resources) so they cannot go missing at
// runtime; keep byte-identical copies under web/_host/ for source-offer/audit purposes.
const hostSrc = resolve(ROOT, 'poc/webview/host');
const hostOut = join(out, '_host');
mkdirSync(hostOut, { recursive: true });
let hostScripts = 0;
for (const name of ['Shim.js', 'Overlay.js']) {
  const src = join(hostSrc, name);
  if (existsSync(src)) { copyFileSync(src, join(hostOut, name.toLowerCase())); hostScripts++; }
}

const summary = {
  generatedAt: new Date().toISOString(),
  out: relative(ROOT, out).replace(/\\/g, '/'),
  webFiles: copied,
  webBytes: bytes,
  hostScriptCopies: hostScripts,
  settingsFiles,
  settingsBytes,
  totalBytes: bytes + settingsBytes,
  excluded: { swTrio: ['registerSW.js', 'sw.js', 'workbox-*.js', 'folia-cover-sw.js', 'manifest.webmanifest'], reason: 'PWA/service-worker files are not needed for a single local page load; registerSW.js tag removed from index.html' },
  missingFromDist: missing,
  indexHtmlPatched: html !== before,
  files: copiedList,
};
writeFileSync(resolve(ROOT, 'packaging/web-stage-report.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ webFiles: copied, webBytes: bytes, settingsFiles, settingsBytes, totalBytes: bytes + settingsBytes, missing: missing.length, indexHtmlPatched: summary.indexHtmlPatched }, null, 2));
