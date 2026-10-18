// WebView spike: static file server + OBS browser-source SSE feed for Folia's production dist.
// Serves the extracted Folia `dist/` and implements the /obs/events protocol consumed by
// src/components/obs/ObsBrowserSourceApp.tsx (events: config, clock, audio).
//
// Query params on /obs/events: token (required, any non-empty value in this spike), mode (one of the
// 14 built-in visualizer modes, default sonnet).
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

function configForMode(mode) {
  return { ...CONFIG, visualizerMode: MODES.includes(mode) ? mode : 'sonnet' };
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  if (pathname === '/obs/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ enabled: true, port: PORT, clients: clients.size }));
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
    const mode = url.searchParams.get('mode') || 'sonnet';
    const client = { res, mode };
    clients.add(client);
    sendEvent(res, 'config', configForMode(mode));
    req.on('close', () => clients.delete(client));
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[spike-server] http://127.0.0.1:${PORT}/?obs=1&token=${TOKEN}`);
  console.log(`[spike-server] dist: ${DIST_ROOT}`);
});
