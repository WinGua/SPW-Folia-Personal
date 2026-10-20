// WebView spike: static file server + OBS browser-source SSE feed for Folia's production dist.
// Serves the extracted Folia `dist/` and implements the /obs/events protocol consumed by
// src/components/obs/ObsBrowserSourceApp.tsx (events: config, clock, audio).
//
// Query params on /obs/events: token (required, any non-empty value in this spike), mode (one of the
// 14 built-in visualizer modes, default sonnet), transparent (0|1, default 0; 1 emits a
// config.background with transparent=true so Folia's background layer renders null), bgmode (which
// background renderer config to attach when transparent=1, default latent — only its `mode`/`common`
// shape matters because the transparent flag short-circuits rendering), tuning (URL-encoded JSON that
// replaces config.visualizerTunings, used by tuned.mjs to test transparent-friendly style patches),
// cover (1 puts a small built-in data-URL PNG in config.coverUrl so cover-driven styles have art),
// theme (URL-encoded JSON theme object replacing config.theme/subtitleTheme, used by tuned2.mjs to
// test light-theme behaviour).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, LINES, LOOP_SECONDS, SPECTRUM_BINS, stateFrame } from '../shared/demoData.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = path.resolve(__dirname, '..', 'dist', 'dist');
const PORT = Number(process.argv[2] || 18080);
const TOKEN = 'spike-token';
const MODES = ['cadenza', 'cappella', 'claddagh', 'classic', 'diorama', 'fume', 'lumiere', 'monet', 'partita', 'pendolo', 'sonnet', 'still', 'tempera', 'tilt'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

const startedAt = Date.now();
const clients = new Set();

const BG_MODES = ['latent', 'monet', 'nomand', 'sora', 'url'];

// Background config the player would build from its own settings store (see rJ() in the Folia bundle):
// { mode, common: { useCoverColorBg, opacity, disableGeometricBackground, disableVignette }, ... }.
// The transparent flag makes every renderer return null, so only mode/common are meaningful here.
function backgroundConfig(bgmode) {
  const mode = BG_MODES.includes(bgmode) ? bgmode : 'latent';
  const config = {
    mode,
    transparent: true,
    common: {
      useCoverColorBg: false,
      opacity: 0.75,
      disableGeometricBackground: false,
      disableVignette: false,
    },
  };
  if (mode === 'url') config.url = { items: [], selectedId: null };
  if (mode === 'latent' || mode === 'monet' || mode === 'nomand' || mode === 'sora') config.tuning = {};
  return config;
}

// `tuning` is a full visualizerTunings object ({<mode>: {...}}) sent straight from the caller.
// IMPORTANT: Folia's tuningRegistry `apply` replaces the style's tuning wholesale
// (`apply:(e,t)=>({...e,temperaTuning:t})`) and the visualizer components then read fields off that
// object (`temperaTuning: N = <defaults>`), so a *partial* object makes every omitted field
// undefined/falsy. Callers must therefore send the complete tuning object with only the target
// fields flipped — tuned.mjs does exactly that.
function configForMode(mode, { transparent, bgmode, tuning, cover, theme } = {}) {
  const config = { ...CONFIG, visualizerMode: MODES.includes(mode) ? mode : 'sonnet' };
  if (transparent) config.background = backgroundConfig(bgmode);
  if (tuning) config.visualizerTunings = tuning;
  if (cover) config.coverUrl = COVER_DATA_URL;
  if (theme) {
    config.theme = theme;
    config.subtitleTheme = theme;
  }
  return config;
}

function sendEvent(res, name, payload) {
  res.write(`event: ${name}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function audioFrame(t) {
  const frame = stateFrame(t);
  return {
    audioPower: frame.power,
    bands: { bass: frame.bands[0], lowMid: frame.bands[1], mid: frame.bands[2], vocal: frame.bands[3], treble: frame.bands[4] },
    spectrum: frame.spectrum,
    sentAtMs: Date.now(),
  };
}

setInterval(() => {
  if (clients.size === 0) return;
  const t = ((Date.now() - startedAt) / 1000) % LOOP_SECONDS;
  const clock = {
    currentTime: t,
    duration: LOOP_SECONDS,
    playerState: 'PLAYING',
    sentAtMs: Date.now(),
    playbackRate: 1,
    lyricOffsetMs: 0,
  };
  const audio = audioFrame(t);
  for (const client of clients) {
    try {
      sendEvent(client.res, 'clock', clock);
      sendEvent(client.res, 'audio', audio);
    } catch {
      clients.delete(client);
    }
  }
}, 1000 / 60);

function serveStatic(req, res, pathname) {
  // Optional second root: /settings-ui/* -> poc/settings-ui/dist (injected settings island).
  const settingsMatch = /^\/settings-ui\/(.*)$/.exec(pathname);
  if (settingsMatch) {
    const settingsRoot = path.resolve(__dirname, '..', '..', 'settings-ui', 'dist');
    const sp = path.resolve(settingsRoot, decodeURIComponent(settingsMatch[1]));
    if (!sp.startsWith(settingsRoot)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.stat(sp, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(sp).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(sp).pipe(res);
    });
    return;
  }
  const normalized = pathname === '/' || pathname === '/obs' ? '/index.html' : pathname;
  const filePath = path.resolve(DIST_ROOT, '.' + decodeURIComponent(normalized));
  if (!filePath.startsWith(DIST_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// The production OBS surface builds its EventSource URL with only the token (see yje() in the Folia
// bundle: new URL('/obs/events') + searchParams.set('token', t)), and headless Edge sends no Referer
// for that request either — so a `mode`/`transparent` given on the *page* URL never reaches this
// endpoint. Callers that want per-request knobs (transparency.mjs) therefore rewrite the SSE request
// URL from the browser side (page.route) and pass them as query params here; the query wins, and the
// Referer is only a best-effort fallback for hosts that do send it.
// `tuning` query param: URL-encoded JSON, e.g. {"tempera":{"showBlocks":false,...}}.
function parseTuning(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Ignore malformed tuning: fall back to the shared CONFIG defaults.
  }
  return null;
}

// `theme` query param: URL-encoded JSON theme object (same shape as demoData.mjs THEME). Used by
// tuned2.mjs to prove the light-theme behaviour of the lumiere dark field; absent => shared CONFIG
// theme, so nothing changes for existing callers.
function parseTheme(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Ignore malformed theme: fall back to the shared CONFIG theme.
  }
  return null;
}

// A tiny 64x64 PNG data URL (head + shoulders silhouette on a dark gradient) used by tuned.mjs'
// cover case: `cover=1` puts it in config.coverUrl so the style has a real album art to draw.
const COVER_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAC+0lEQVR4AeXBMXKVVQCA0fPduUtgkAHHwrGwoKARYUjiDMvQKmEDlpDUlCRuwAriPrSCuA3XwAADxhUgBN7L8N5/Tt98e+vcgk2yZLMs2iRLNsuiTbJkw8LNypINCzcrSzYs3CRLNsuiTXKZ/v7jyIf88PNjl6Xvvv/x3CU4Oz1yUbd/eWzdBiGEEEIIIYQQQgghhBBCCDk7PfIpzk6PEEIIIYQQQgghhBBCCCGEDGt2dnroc5ydHlqnUalUKpVKpVKpVCqVSqVSqVQqlUrl7PTQKpydHqpUKpVKpVKpVCqVSqVSqVQqlUplWJMXzx5ZpRfPHlmHWdkUlVUb1uD504fW4fnTh1Ztks2SVZplo5SVmmSzZJVm2ShlpSbZLFmlYeFmZZNUVmlYuFGpVCqVSqVSqVQqlUqlUqlUKpWd/SfWYWf/iUqlUqlUKpVKpVKpVCqVSqVSGRZuEEIIIYQQQgghhBBCCCE7+8dWaWf/GCGEEEIIIYQQQgghhJBRFEVRFEVRFEVRFEVRFEVRFMXuwbFV2D04VhRFURRFURRFURRFURRFURSDEEIIIYQQQgghhBBCCCFk9+DE59g9OEEIIYQQQgghhBBCCCGEkFEURVEURVEURVEURVEURVEURVHsPTjxKfYenCiKoiiKoiiKoiiKoiiKoiiKoujmrfvnLtFfv//qQ/Ye/OaydPPW/XMLNitLNizcrCzZsHCTfIp/v/7Jl2b886eLmmVrlAubZHvkokZRFEVRFEVRFEXx7saeL9G7G3uKoiiKoiiKoigm2S65iGHhRqVSqVQqlUqlUqm8vb7rS/b2+q5KpVKpVCqVSqUyLNysbJvKxxoWbhBCCCGEEELeXLtnE7y5dg8hhBBCCCGzbKXyUSbZTvkYoyiKoiiKoihef3XXJnn91V1FURRFURTFJNsrHzIs3KhUKpVKpVKpvLp6xyZ6dfWOSqVSqVQqlWHhZmWbVf7PsHCDEEIIIeTllds22csrtxFCCCFklq1X3muS7Zf3+Q/BhkTJN3VtkgAAAABJRU5ErkJggg==';

function resolveKnobs(url, req) {
  const pick = (name) => {
    const direct = url.searchParams.get(name);
    if (direct !== null) return direct;
    const referer = req.headers.referer;
    if (!referer) return null;
    try {
      return new URL(referer).searchParams.get(name);
    } catch {
      return null;
    }
  };
  return {
    mode: pick('mode') || 'sonnet',
    transparent: pick('transparent') === '1',
    bgmode: pick('bgmode') || 'latent',
    tuning: parseTuning(pick('tuning')),
    cover: pick('cover') === '1',
    theme: parseTheme(pick('theme')),
    referer: req.headers.referer ?? null,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  if (pathname === '/obs/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      enabled: true,
      port: PORT,
      clients: clients.size,
      clientInfo: [...clients].map((c) => ({ mode: c.mode, transparent: c.transparent, referer: c.referer })),
    }));
    return;
  }
  if (pathname === '/obs/events') {
    if (!url.searchParams.get('token')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    const { mode, transparent, bgmode, tuning, cover, theme, referer } = resolveKnobs(url, req);
    const client = { res, mode, transparent, referer };
    clients.add(client);
    sendEvent(res, 'config', configForMode(mode, { transparent, bgmode, tuning, cover, theme }));
    req.on('close', () => clients.delete(client));
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[spike-server] http://127.0.0.1:${PORT}/?obs=1&token=${TOKEN}`);
  console.log(`[spike-server] dist: ${DIST_ROOT}`);
});
