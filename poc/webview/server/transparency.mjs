// Transparency evidence table for all 14 Folia lyric/visualizer styles.
//
// For each style we render the production OBS browser-source surface (ObsBrowserSourceApp) twice:
//   opaque    — server config without `background` (what the app looks like normally)
//   transparent — server config with `background:{ transparent:true, ... }`, which makes Folia's
//                 background layer render nothing (the `E` renderer in usePlayerOverlayLayout-*.js
//                 returns null when config.transparent is set). Whatever stays opaque in that shot is
//                 therefore drawn by the style itself (visualizer + lyrics/subtitle layer), not by the
//                 background renderer — i.e. it is the part that would be opaque in a transparent window.
//
// Note on knob delivery: the OBS surface builds its EventSource URL with only `token`, so `mode` /
// `transparent` on the page URL never reach /obs/events. We rewrite the SSE request URL with
// page.route() to append them (server.mjs reads them from the SSE query).
//
// Run: node transparency.mjs   → out/transparency/{<mode>-opaque,<mode>-transparent}.png + report.json
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18082;
const TOKEN = 'spike-token';
const OUT = path.join(__dirname, 'out', 'transparency');
const VIEWPORT = { width: 1920, height: 1080 };
const SETTLE_MS = 5000;
const MODES = ['sonnet', 'tempera', 'lumiere', 'classic', 'cadenza', 'partita', 'fume', 'tilt', 'claddagh', 'monet', 'pendolo', 'cappella', 'diorama', 'still'];
const VARIANTS = ['opaque', 'transparent'];

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// PNG alpha analysis
// ---------------------------------------------------------------------------------------------

// Alpha histogram over every pixel (no sampling: the question is exactly how many pixels are opaque).
function analyzeAlpha(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const total = width * height;
  let a0 = 0;
  let aPartial = 0;
  let a255 = 0;
  let aAbove8 = 0;
  const grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ total: 0, above8: 0 })));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a === 0) a0++;
      else {
        if (a === 255) a255++;
        else aPartial++;
        if (a > 8) aAbove8++;
      }
      const cell = grid[Math.min(2, Math.floor((y / height) * 3))][Math.min(2, Math.floor((x / width) * 3))];
      cell.total++;
      if (a > 8) cell.above8++;
    }
  }
  const r4 = (v) => Math.round(v * 10000) / 10000;
  // Pixel visibility bands: how "solidly" the layer stack covers the window.
  let alphaSum = 0;
  let bands = { gt8: 0, gt32: 0, gt64: 0, gt128: 0, gt192: 0, gt250: 0 };
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    alphaSum += a;
    if (a > 8) bands.gt8++;
    if (a > 32) bands.gt32++;
    if (a > 64) bands.gt64++;
    if (a > 128) bands.gt128++;
    if (a > 192) bands.gt192++;
    if (a > 250) bands.gt250++;
  }
  return {
    width,
    height,
    totalPixels: total,
    // Mean alpha = average window opacity. 255 = fully opaque window, 0 = fully see-through.
    meanAlpha: Math.round((alphaSum / total) * 10) / 10,
    alphaZeroRatio: r4(a0 / total),
    alphaPartialRatio: r4(aPartial / total),
    alphaFullRatio: r4(a255 / total),
    alphaAbove8Ratio: r4(aAbove8 / total),
    gridAbove8Ratio: grid.map((row) => row.map((c) => r4(c.above8 / c.total))),
    // A window is "usable transparent" only if most pixels are actually see-through.
    bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, r4(v / total)])),
  };
}

// Opaque screenshot only: luminance stats + flatness (is the baseline a plain background fill?).
function analyzeOpaque(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const total = width * height;
  const buckets = new Map();
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const step = 4;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      sumSq += lum * lum;
      count++;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const mean = sum / count;
  const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
  const dominant = Math.max(...buckets.values()) / count;
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return {
    sampledPixels: count,
    meanLum: r2(mean),
    stdLum: r2(std),
    dominantColorRatio: r4(dominant),
    distinctColors: buckets.size,
    totalPixels: total,
    flat: std < 3 || dominant > 0.995,
  };
}

// ---------------------------------------------------------------------------------------------
// Stage interaction inventory (what a click/wheel would land on, and where)
// ---------------------------------------------------------------------------------------------

function collectStage(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
    };
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const label = (el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
    };

    const selectors = {
      button: 'button',
      roleButton: '[role="button"]',
      cursorPointer: '*',
      canvas: 'canvas',
    };
    const counts = {};
    const items = [];

    const buttons = [...document.querySelectorAll(selectors.button)].filter(visible);
    counts.button = buttons.length;
    for (const el of buttons.slice(0, 20)) items.push({ kind: 'button', label: label(el), rect: rect(el) });

    const roleButtons = [...document.querySelectorAll(selectors.roleButton)].filter(visible);
    counts.roleButton = roleButtons.length;
    for (const el of roleButtons.slice(0, 20)) items.push({ kind: 'roleButton', label: label(el), rect: rect(el) });

    // cursor:pointer elements other than buttons (Folia uses these a lot for lyric rows / cards)
    const pointers = [...document.querySelectorAll(selectors.cursorPointer)].filter(
      (el) => visible(el) && getComputedStyle(el).cursor === 'pointer',
    );
    counts.cursorPointer = pointers.length;
    const seen = new Set();
    for (const el of pointers) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (items.length < 60) items.push({ kind: 'cursorPointer', label: label(el), rect: rect(el) });
    }

    const canvases = [...document.querySelectorAll(selectors.canvas)].filter(visible);
    counts.canvas = canvases.length;
    for (const el of canvases) {
      items.push({ kind: 'canvas', label: label(el), rect: rect(el), bitmap: `${el.width}x${el.height}` });
    }

    return {
      viewport: { w: vw, h: vh },
      counts,
      items: items.slice(0, 80),
      stageRoot: (() => {
        const root = document.getElementById('root');
        const first = root?.firstElementChild;
        if (!first) return null;
        const cs = getComputedStyle(first);
        return {
          label: label(first),
          rect: rect(first),
          backgroundColor: cs.backgroundColor,
          backgroundImage: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage.slice(0, 200),
          styleAttr: first.getAttribute('style')?.slice(0, 300) ?? null,
        };
      })(),
      splashPresent: !!document.getElementById('app-splash'),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
    };
  });
}

// Explicit evidence for an opaque transparent-shot: which DOM/canvas layers actually cover the screen.
// Walks elements whose visible box covers a large share of the viewport and records their paint props.
function collectOpaqueLayers(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const area = vw * vh;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const cover = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (cover <= 0) continue;
      const ratio = cover / area;
      if (ratio < 0.25) continue;
      const cs = getComputedStyle(el);
      const paint =
        (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
        cs.backgroundImage !== 'none' ||
        el.tagName === 'CANVAS' ||
        (cs.boxShadow && cs.boxShadow !== 'none') ||
        (cs.filter && cs.filter !== 'none') ||
        cs.backdropFilter !== 'none';
      if (!paint) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        class: cls || null,
        rect: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        coverRatio: Math.round(ratio * 1000) / 1000,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage.slice(0, 240),
        opacity: cs.opacity,
        filter: cs.filter,
        canvasBitmap: el.tagName === 'CANVAS' ? `${el.width}x${el.height}` : null,
      });
    }
    return out.sort((a, b) => b.coverRatio - a.coverRatio).slice(0, 12);
  });
}

// For styles whose opaque pixels are NOT concentrated in one big layer (no element covers >=25% of the
// viewport), collect the smaller painted elements that add up to the coverage. This is the explicit
// evidence for "the style paints many small pieces" instead of one full-screen rectangle.
function scanPaintedDistribution(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const area = vw * vh;
    const out = [];
    let paintedArea = 0;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const cover = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (cover <= 0) continue;
      const ratio = cover / area;
      if (ratio < 0.002) continue; // ignore sub-0.2% specks
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const isCanvas = el.tagName === 'CANVAS';
      const paint =
        isCanvas ||
        (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
        cs.backgroundImage !== 'none' ||
        (cs.boxShadow && cs.boxShadow !== 'none') ||
        (cs.filter && cs.filter !== 'none') ||
        cs.backdropFilter !== 'none';
      if (!paint) continue;
      paintedArea += ratio;
      const cls = typeof el.className === 'string' ? el.className : '';
      const paintKinds = [];
      if (isCanvas) paintKinds.push('canvas');
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') paintKinds.push('backgroundColor');
      if (cs.backgroundImage !== 'none') paintKinds.push('backgroundImage');
      if (cs.boxShadow && cs.boxShadow !== 'none') paintKinds.push('boxShadow');
      if (cs.filter && cs.filter !== 'none') paintKinds.push('filter');
      if (cs.backdropFilter !== 'none') paintKinds.push('backdropFilter');
      out.push({
        tag: el.tagName.toLowerCase(),
        class: cls.slice(0, 120) || null,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        coverRatio: Math.round(ratio * 10000) / 10000,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage.slice(0, 160),
        opacity: cs.opacity,
        filter: cs.filter,
        canvasBitmap: isCanvas ? `${el.width}x${el.height}` : null,
        paintKinds,
        // A "plate" really fills pixels: a canvas bitmap, a background colour or a background image.
        // box-shadow / filter / backdrop-filter only decorate whatever is under them.
        isPlate: isCanvas || paintKinds.includes('backgroundColor') || paintKinds.includes('backgroundImage'),
      });
    }
    out.sort((a, b) => b.coverRatio - a.coverRatio);
    const counts = { gt25: 0, gt10: 0, gt2: 0, gt05: 0, total: out.length };
    for (const e of out) {
      if (e.coverRatio >= 0.25) counts.gt25++;
      else if (e.coverRatio >= 0.1) counts.gt10++;
      else if (e.coverRatio >= 0.02) counts.gt2++;
      else if (e.coverRatio >= 0.005) counts.gt05++;
    }
    return {
      paintedElements: out.length,
      paintedAreaSumRatio: Math.round(paintedArea * 1000) / 1000,
      counts,
      top: out.slice(0, 10),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Ablation: hide the candidate covering layer and re-measure alpha coverage.
// This turns "the layer looks big" into proof: the drop in alpha>8 is *caused* by that element.
// ---------------------------------------------------------------------------------------------

// Stash the top covering elements on `window.__ablate` so they can be toggled by index.
// Pseudo-elements are checked too: a Tailwind `before:*`/`after:*` gradient paints without being a real
// element, so an element whose ::before carries a background is recorded as painting.
function stashLayers(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const area = vw * vh;
    const pseudoPaints = (el) => {
      for (const which of ['::before', '::after']) {
        const ps = getComputedStyle(el, which);
        if (ps.content === 'none' || ps.content === 'normal') continue;
        if (ps.backgroundColor === 'rgba(0, 0, 0, 0)' && ps.backgroundImage === 'none' && ps.boxShadow === 'none') continue;
        const pos = ps.position;
        if (pos === 'absolute' || pos === 'fixed') return which;
      }
      return null;
    };
    const arr = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const cover = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (cover <= 0) continue;
      const ratio = cover / area;
      if (ratio < 0.25) continue;
      const cs = getComputedStyle(el);
      const pseudo = pseudoPaints(el);
      const paint =
        (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
        cs.backgroundImage !== 'none' ||
        el.tagName === 'CANVAS' ||
        (cs.boxShadow && cs.boxShadow !== 'none') ||
        (cs.filter && cs.filter !== 'none') ||
        cs.backdropFilter !== 'none' ||
        !!pseudo;
      if (!paint) continue;
      arr.push({ el, ratio, pseudo });
    }
    arr.sort((a, b) => b.ratio - a.ratio);
    const picked = arr.slice(0, 4);
    window.__ablate = picked.map((x) => x.el);
    // Register per-element ids so a stylesheet can hide the element *and* its pseudo-elements.
    picked.forEach((x, i) => x.el.setAttribute('data-ablate', String(i)));
    return picked.map((x, i) => ({
      index: i,
      tag: x.el.tagName.toLowerCase(),
      class: (typeof x.el.className === 'string' ? x.el.className : '').slice(0, 160),
      canvasBitmap: x.el.tagName === 'CANVAS' ? `${x.el.width}x${x.el.height}` : null,
      rect: (() => {
        const r = x.el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      })(),
      pseudoElement: x.pseudo,
    }));
  });
}

// Cumulative ablation: hide layers 0..k for k=0..n-1 and re-shoot after each step. The marginal drop
// between consecutive steps is the causal contribution of layer k (single-layer hiding is not enough
// when two overlapping canvases paint the same pixels — that is the pendolo case).
async function ablateLayers(page, mode, stashed) {
  const total = stashed.length;
  const steps = [];
  const shoot = async (tag) => {
    const file = path.join(OUT, 'ablate', `${mode}-${tag}.png`);
    await page.screenshot({ path: file, omitBackground: true, fullPage: false });
    return { tag, screenshot: path.relative(__dirname, file).split(path.sep).join('/'), alpha: analyzeAlpha(file) };
  };

  const baseline = await shoot('ablate-baseline');
  for (let k = 0; k < total; k++) {
    await page.addStyleTag({
      content: Array.from({ length: k + 1 }, (_, i) => `[data-ablate="${i}"], [data-ablate="${i}"]::before, [data-ablate="${i}"]::after { visibility: hidden !important; }`).join('\n'),
    });
    await sleep(800); // let canvas/rAF repaint with the layer removed
    const shot = await shoot(`ablate-hide-0to${k}`);
    shot.hiddenCount = k + 1;
    shot.marginalDrop = Math.round((steps.length ? steps[steps.length - 1].alpha.alphaAbove8Ratio : baseline.alpha.alphaAbove8Ratio) * 10000 - shot.alpha.alphaAbove8Ratio * 10000) / 10000;
    steps.push(shot);
  }
  return { baseline, steps, layers: stashed };
}

// ---------------------------------------------------------------------------------------------
// Server + browser plumbing
// ---------------------------------------------------------------------------------------------

async function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not report ready in 15s')), 15000);
    child.stdout.on('data', (buf) => {
      process.stdout.write(`[srv] ${buf}`);
      if (String(buf).includes('[spike-server]')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (buf) => process.stderr.write(`[srv!] ${buf}`));
  });
}

async function capture(browser, mode, variant) {
  const transparent = variant === 'transparent';
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const blockedExternal = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 500)));
  page.on('requestfailed', (req) => failedRequests.push(`${req.url().slice(0, 200)} :: ${req.failure()?.errorText ?? 'unknown'}`));
  page.on('request', (req) => {
    const u = req.url();
    if (/^https?:\/\//.test(u) && !u.includes(`127.0.0.1:${PORT}`)) blockedExternal.push(u.slice(0, 200));
  });

  // mode/transparent must be injected on the SSE request itself (see file header).
  await page.route('**/obs/events*', async (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('mode', mode);
    u.searchParams.set('transparent', transparent ? '1' : '0');
    await route.continue({ url: u.toString() });
  });

  let canvasOk = false;
  let loadError = null;
  const shot = path.join(OUT, `${mode}-${variant}.png`);
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?obs=1&token=${TOKEN}`, { waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForSelector('canvas', { timeout: 12000 });
      canvasOk = true;
    } catch {
      // DOM-only styles legitimately have no canvas; keep going.
    }
    await sleep(SETTLE_MS);
    const stage = await collectStage(page);
    const layers = transparent ? await collectOpaqueLayers(page) : null;
    await page.screenshot({ path: shot, omitBackground: true, fullPage: false });

    // Measurement noise: the visualizers are time-based, so a single frame's mean alpha depends on the
    // animation phase. Re-shoot twice more (BEFORE any ablation, so the scene is untouched) and keep the
    // spread, so the report can distinguish stable coverage from a noisy brightness number.
    let stability = null;
    if (transparent) {
      const samples = [];
      for (let i = 1; i <= 2; i++) {
        await sleep(700);
        const f = path.join(OUT, `${mode}-transparent-s${i}.png`);
        await page.screenshot({ path: f, omitBackground: true, fullPage: false });
        samples.push({ screenshot: path.relative(__dirname, f).split(path.sep).join('/'), alpha: analyzeAlpha(f) });
      }
      stability = samples;
    }

    // If the transparent shot still covers a lot of the window, prove *which* layer does it by
    // hiding the candidates cumulatively and re-measuring alpha coverage.
    let ablation = null;
    let layerScan = null;
    if (transparent) {
      const base = analyzeAlpha(shot);
      const triggered = base.alphaAbove8Ratio > 0.2;
      const stashed = triggered ? await stashLayers(page) : [];
      layerScan = { triggered, candidates: stashed.length };
      if (stashed.length) ablation = await ablateLayers(page, mode, stashed);
      // No single layer covers >=25% but the window is still partly painted => the coverage comes from
      // many small pieces. Enumerate them so the report can say what is actually being drawn.
      if (!stashed.length && base.alphaAbove8Ratio > 0.02) {
        layerScan.distribution = await scanPaintedDistribution(page);
      }
    }
    return { shot, canvasOk, loadError, stage, layers, ablation, layerScan, stability, consoleErrors, pageErrors, failedRequests, blockedExternal };
  } catch (err) {
    loadError = String(err).slice(0, 500);
    return { shot: null, canvasOk, loadError, stage: null, layers: null, ablation: null, layerScan: null, stability: null, consoleErrors, pageErrors, failedRequests, blockedExternal };
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

const CELL_NAMES = [
  ['top-left', 'top-center', 'top-right'],
  ['mid-left', 'mid-center', 'mid-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];

// Human-readable description of *where* the opaque pixels sit, from the 3x3 grid.
function describeRegion(grid, overallCoverage) {
  const hot = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      if (grid[y][x] >= 0.02) hot.push(`${CELL_NAMES[y][x]} ${(grid[y][x] * 100).toFixed(1)}%`);
    }
  }
  if (!hot.length) return 'nowhere (all 9 cells <2%)';
  if (hot.length === 9) {
    // "all 9 cells" only means a full-screen fill when the overall coverage really is full-screen;
    // a style that sprinkles small elements into every cell is scattered, not a background plate.
    return overallCoverage >= 0.9
      ? 'all 9 cells (full-screen fill)'
      : `all 9 cells but only ${(overallCoverage * 100).toFixed(1)}% of pixels overall (scattered small elements, no full-screen plate)`;
  }
  const peak = hot.slice().sort((a, b) => parseFloat(b.split(' ').pop()) - parseFloat(a.split(' ').pop()))[0];
  return `${hot.join(', ')}  [peak ${peak}]`;
}

function classify(result) {
  const t = result.transparent?.alpha;
  if (!t) return { verdict: 'error', verdictLabel: '无法测量', reason: 'transparent shot missing', region: 'unknown' };
  const above8 = t.alphaAbove8Ratio;
  const full = t.alphaFullRatio;
  const grid = t.gridAbove8Ratio;
  const flatCells = grid.flat().filter((v) => v < 0.02).length;
  const region = describeRegion(grid, above8);

  // Best causal evidence: the cumulative ablation run that hid layer k and watched coverage fall.
  // Cumulative is required: two overlapping canvases each cover the same pixels, so hiding one alone
  // changes nothing (the pendolo case).
  const ab = result.transparent.ablation;
  let culprit = null;
  if (ab?.steps?.length) {
    const from = (i) => (i === 0 ? ab.baseline.alpha.alphaAbove8Ratio : ab.steps[i - 1].alpha.alphaAbove8Ratio);
    let best = null;
    ab.steps.forEach((step, i) => {
      const marginal = from(i) - step.alpha.alphaAbove8Ratio;
      if (!best || marginal > best.marginal) best = { step, i, marginal };
    });    const totalDrop = ab.baseline.alpha.alphaAbove8Ratio - ab.steps[ab.steps.length - 1].alpha.alphaAbove8Ratio;
    if (best && best.marginal > 0.05) {
      const h = ab.layers ? ab.layers[best.i] : null;
      culprit = {
        kind: 'ablation',
        drop: Math.round(best.marginal * 10000) / 10000,
        element: h ? `<${h.tag} class="${h.class}">${h.canvasBitmap ? ` canvas bitmap ${h.canvasBitmap}` : ''}` : `layer #${best.i}`,
        elementRect: h?.rect ?? null,
        coveredAfterHide: best.step.alpha.alphaAbove8Ratio,
        detail: `hiding layer #${best.i} drops alpha>8 coverage from ${(from(best.i) * 100).toFixed(1)}% to ${(best.step.alpha.alphaAbove8Ratio * 100).toFixed(1)}%`,
        screenshot: best.step.screenshot,
      };
    } else {
      culprit = {
        kind: 'ablation-none',
        totalDrop: Math.round(totalDrop * 10000) / 10000,
        detail: `hiding all ${ab.steps.length} large painted layer(s) only cut coverage by ${(totalDrop * 100).toFixed(1)}pp — opaque pixels are spread across many small elements, not one full-screen layer`,
        screenshot: ab.steps[ab.steps.length - 1].screenshot,
      };
    }
  } else if (result.transparent?.layerScan?.distribution) {
    // Nothing was big enough to ablate, so describe what IS painted. Three honest shapes:
    //  (a) a full-screen canvas plate whose own bitmap is mostly transparent (sparse glyphs/particles);
    //  (b) a local plate (a card/cover block) — a style element, not a background;
    //  (c) no plate at all — the remaining non-transparent pixels are text/subtitle glyphs.
    const d = result.transparent.layerScan.distribution;
    const biggest = d.top[0];
    const plates = d.top.filter((e) => e.isPlate && e.coverRatio >= 0.25);
    const fullScreenPlate = plates.find((e) => e.coverRatio >= 0.9);
    if (fullScreenPlate) {
      const f = fullScreenPlate;
      culprit = {
        kind: 'sparse-fullscreen-layer',
        paintedElements: d.paintedElements,
        element: `<${f.tag}${f.class ? ` class="${f.class}"` : ''}${f.canvasBitmap ? ` canvas bitmap ${f.canvasBitmap}` : ''}>`,
        rect: f.rect,
        detail: `a full-screen <${f.tag}${f.canvasBitmap ? ' canvas' : ''}> exists (@ ${f.rect.w}x${f.rect.h}) but only ${(above8 * 100).toFixed(1)}% of window pixels have alpha>8 — its own bitmap/background is mostly transparent, so it paints sparse content instead of an opaque plate`,
      };
    } else if (plates.length) {
      const p = plates[0];
      culprit = {
        kind: 'local-plate',
        element: `<${p.tag}${p.class ? ` class="${p.class}"` : ''}>`,
        rect: p.rect,
        coverRatio: p.coverRatio,
        detail: `no full-screen plate; the largest painted plate is <${p.tag}> covering ${(p.coverRatio * 100).toFixed(1)}% of the viewport (@ ${p.rect.w}x${p.rect.h}) — a local style element, not a background`,
      };
    } else {
      culprit = {
        kind: 'no-plate',
        paintedElements: d.paintedElements,
        paintedAreaSumRatio: d.paintedAreaSumRatio,
        biggest: biggest
          ? {
              element: `<${biggest.tag}${biggest.class ? ` class="${biggest.class}"` : ''}`,
              coverRatio: biggest.coverRatio,
              rect: biggest.rect,
              canvasBitmap: biggest.canvasBitmap,
            }
          : null,
        detail: `no painted element covers >=25% of the viewport and none paints a plate — the ${(above8 * 100).toFixed(1)}% of non-transparent pixels come from text/subtitle glyphs and small decorations (${d.paintedElements} painted element(s), bounding-box area sum ${(d.paintedAreaSumRatio * 100).toFixed(1)}%)`,
      };
    }
  }

  if (above8 >= 0.98) {
    return {
      verdict: 'opaque-fullscreen',
      verdictLabel: '不可适配（整屏不透明）',
      reason: `${(above8 * 100).toFixed(1)}% of pixels are opaque (>8), meanAlpha ${t.meanAlpha}/255 — a transparent window would still show a fully painted rectangle`,
      region,
      culprit,
    };
  }
  if (above8 <= 0.02) {
    return {
      verdict: 'fully-transparent',
      verdictLabel: '完全透明',
      reason: `only ${(above8 * 100).toFixed(2)}% of pixels above alpha 8`,
      region,
      culprit,
    };
  }
  if (above8 <= 0.35 && full < 0.35) {
    return {
      verdict: 'adaptable',
      verdictLabel: '可适配（只有文字/字幕与局部样式元素不透明）',
      reason: `${(above8 * 100).toFixed(1)}% coverage, meanAlpha ${t.meanAlpha}/255, ${flatCells}/9 grid cells <2%`,
      region,
      culprit,
    };
  }
  return {
    verdict: 'partial',
    verdictLabel: '需处理（覆盖面积介于两者之间）',
    reason: `${(above8 * 100).toFixed(1)}% coverage, meanAlpha ${t.meanAlpha}/255, ${flatCells}/9 grid cells <2%`,
    region,
    culprit,
  };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const generatedAt = new Date().toISOString();
  const child = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  const results = [];
  try {
    await waitForServer(child);
    browser = await chromium.launch({
      channel: 'msedge',
      headless: true,
      args: ['--window-size=1920,1080', '--enable-precise-memory-info', '--hide-scrollbars', '--disable-gpu-vsync'],
    });

    for (const mode of MODES) {
      const row = { mode };
      for (const variant of VARIANTS) {
        process.stdout.write(`[transparency] ${mode}/${variant} ... `);
        const cap = await capture(browser, mode, variant);
        const png = cap.shot ? analyzeAlpha(cap.shot) : null;
        const opaqueStats = variant === 'opaque' && cap.shot ? analyzeOpaque(cap.shot) : null;
        row[variant] = {
          screenshot: cap.shot ? path.relative(__dirname, cap.shot).split(path.sep).join('/') : null,
          canvasOk: cap.canvasOk,
          loadError: cap.loadError,
          alpha: png,
          opaqueStats,
          stage: cap.stage,
          layers: cap.layers,
          ablation: cap.ablation,
          layerScan: cap.layerScan,
          stability: cap.stability,
          consoleErrors: cap.consoleErrors.slice(0, 8),
          pageErrors: cap.pageErrors.slice(0, 8),
          failedRequests: cap.failedRequests.slice(0, 8),
          blockedExternal: [...new Set(cap.blockedExternal)].slice(0, 8),
        };
        console.log(
          png
            ? `alpha>8=${(png.alphaAbove8Ratio * 100).toFixed(1)}% meanAlpha=${png.meanAlpha}` +
                (cap.ablation ? ` [ablated ${cap.ablation.layers.length} layer(s)]` : '')
            : `FAILED (${cap.loadError})`,
        );
      }
      row.verdict = classify(row);
      results.push(row);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    child.kill('SIGKILL');
  }

  const report = {
    generatedAt,
    port: PORT,
    viewport: VIEWPORT,
    settleMs: SETTLE_MS,
    token: TOKEN,
    note: 'transparent variant gets config.background={transparent:true,...} so Folia renders no background layer; remaining opaque pixels are drawn by the style + subtitle layer.',
    method: {
      knobDelivery: 'OBS surface builds EventSource with only ?token=, so mode/transparent are injected by rewriting the /obs/events request URL with page.route().',
      screenshot: 'page.screenshot({ omitBackground: true }) — PNG alpha channel = actual window transparency.',
      ablation: 'for shots with alpha>8 coverage above 20%, the up-to-4 largest painted layers (including ::before/::after pseudo-elements) are hidden cumulatively (layers 0..k) and re-shot after each step; the marginal coverage drop between consecutive steps is the causal contribution of that layer.',
    },
    modes: MODES,
    results,
  };
  const reportPath = path.join(OUT, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Console table.
  const pad = (v, n) => String(v).padEnd(n);
  const padl = (v, n) => String(v).padStart(n);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  console.log('\n=== 1) transparent variant: alpha coverage of the whole 1920x1080 window ===');
  console.log(
    pad('mode', 10) +
      padl('meanA', 7) +
      padl('a==0', 8) +
      padl('0<a<255', 9) +
      padl('a==255', 8) +
      padl('a>8', 8) +
      padl('a>64', 8) +
      padl('grid<2%', 9) +
      '  verdict',
  );
  for (const r of results) {
    const t = r.transparent?.alpha;
    if (!t) {
      console.log(pad(r.mode, 10) + 'MISSING TRANSPARENT SHOT');
      continue;
    }
    const flat = t.gridAbove8Ratio.flat().filter((v) => v < 0.02).length;
    console.log(
      pad(r.mode, 10) +
        padl(t.meanAlpha, 7) +
        padl(pct(t.alphaZeroRatio), 8) +
        padl(pct(t.alphaPartialRatio), 9) +
        padl(pct(t.alphaFullRatio), 8) +
        padl(pct(t.alphaAbove8Ratio), 8) +
        padl(pct(t.bands.gt64), 8) +
        padl(`${flat}/9`, 9) +
        '  ' +
        r.verdict.verdictLabel,
    );
  }

  console.log('\n=== 1b) measurement stability (3 frames of the same page, unmodified) ===');
  console.log(
    pad('mode', 10) + padl('a>8 f0', 9) + padl('f1', 8) + padl('f2', 8) + padl('Δcov', 8) +
      padl('meanA0', 9) + padl('f1', 8) + padl('f2', 8) + '  stable?',
  );
  for (const r of results) {
    const t = r.transparent?.alpha;
    const s = r.transparent?.stability;
    if (!t || !s) continue;
    const cov = [t.alphaAbove8Ratio, ...s.map((x) => x.alpha.alphaAbove8Ratio)];
    const mean = [t.meanAlpha, ...s.map((x) => x.alpha.meanAlpha)];
    const spread = Math.max(...cov) - Math.min(...cov);
    console.log(
      pad(r.mode, 10) +
        padl(pct(cov[0]), 9) + padl(pct(cov[1]), 8) + padl(pct(cov[2]), 8) + padl(`${(spread * 100).toFixed(1)}pp`, 8) +
        padl(mean[0], 9) + padl(mean[1], 8) + padl(mean[2], 8) +
        '  ' + (spread <= 0.03 ? 'yes' : 'NO (animated)'),
    );
  }

  console.log('\n=== 1c) painted-element distribution (styles with no >=25% layer to ablate) ===');
  for (const r of results) {
    const d = r.transparent?.layerScan?.distribution;
    if (!d) continue;
    const c = d.counts;
    const plates = d.top.filter((e) => e.isPlate && e.coverRatio >= 0.25).length;
    console.log(
      pad(r.mode, 10) +
        `painted=${c.total}  bboxSum=${(d.paintedAreaSumRatio * 100).toFixed(1)}%  ` +
        `>=25%:${c.gt25}  10-25%:${c.gt10}  2-10%:${c.gt2}  0.5-2%:${c.gt05}  plates>=25%:${plates}`,
    );
    for (const e of d.top.slice(0, 3)) {
      console.log(
        pad('', 10) +
          `  <${e.tag}${e.class ? ` class="${e.class}"` : ''}> ${(e.coverRatio * 100).toFixed(1)}% @ ${e.rect.w}x${e.rect.h}` +
          `${e.canvasBitmap ? ` canvas ${e.canvasBitmap}` : ''}${e.isPlate ? ' [plate]' : ` [${e.paintKinds.join('+')}]`}`,
      );
    }
  }
  if (!results.some((r) => r.transparent?.layerScan?.distribution)) console.log('n/a: every measured style had at least one >=25% covering layer');

  console.log('\n=== 2) where the opaque pixels are (3x3 grid, alpha>8) ===');
  for (const r of results) {
    const t = r.transparent?.alpha;
    if (!t) continue;
    console.log(pad(r.mode, 10) + r.verdict.region);
  }

  console.log('\n=== 3) stage interactive inventory (transparent variant) ===');
  console.log(pad('mode', 10) + padl('button', 8) + padl('role=btn', 10) + padl('cursor:ptr', 12) + padl('canvas', 8) + '  stageRoot background');
  for (const r of results) {
    const s = r.transparent?.stage;
    if (!s) {
      console.log(pad(r.mode, 10) + '  (no stage snapshot)');
      continue;
    }
    console.log(
      pad(r.mode, 10) +
        padl(s.counts.button, 8) +
        padl(s.counts.roleButton, 10) +
        padl(s.counts.cursorPointer, 12) +
        padl(s.counts.canvas, 8) +
        '  ' +
        (s.stageRoot?.backgroundColor ?? 'n/a'),
    );
  }

  console.log('\n=== 4) opaque baseline luminance (is the default look a flat fill?) ===');
  console.log(pad('mode', 10) + padl('meanLum', 9) + padl('stdLum', 8) + padl('dominant', 10) + padl('colors', 8) + '  flat');
  for (const r of results) {
    const o = r.opaque?.opaqueStats;
    if (!o) {
      console.log(pad(r.mode, 10) + '  n/a');
      continue;
    }
    console.log(
      pad(r.mode, 10) +
        padl(o.meanLum, 9) +
        padl(o.stdLum, 8) +
        padl(pct(o.dominantColorRatio), 10) +
        padl(o.distinctColors, 8) +
        '  ' +
        o.flat,
    );
  }

  console.log('\n=== 5) causality: hide the biggest layers cumulatively, re-measure ===');
  for (const r of results) {
    const c = r.verdict.culprit;
    const ab = r.transparent?.ablation;
    if (!c) continue;
    console.log(pad(r.mode, 10) + c.detail);
    if (c.element) console.log(pad('', 10) + '  ' + c.element + (c.elementRect ? ` @ ${c.elementRect.w}x${c.elementRect.h}` : '') + '  → ' + c.screenshot);
    if (c.kind === 'no-plate' && c.biggest) {
      console.log(pad('', 10) + `  largest: ${c.biggest.element} ${(c.biggest.coverRatio * 100).toFixed(1)}% @ ${c.biggest.rect.w}x${c.biggest.rect.h}`);
    }
    if (c.kind === 'local-plate') {
      console.log(pad('', 10) + `  ${c.element} ${(c.coverRatio * 100).toFixed(1)}% @ ${c.rect.w}x${c.rect.h}`);
    }
    if (c.kind === 'sparse-fullscreen-layer') {
      console.log(pad('', 10) + `  ${c.element} @ ${c.rect.w}x${c.rect.h}`);
    }
    if (ab?.steps?.length) {
      const from = (i) => (i === 0 ? ab.baseline.alpha : ab.steps[i - 1].alpha);
      ab.steps.forEach((step, i) => {
        const h = ab.layers?.[i];
        console.log(
          pad('', 10) +
            `  hide #${i} (${h ? `${h.tag}${h.canvasBitmap ? ' ' + h.canvasBitmap : ''}` : 'layer'}) ` +
            `coverage ${(from(i).alphaAbove8Ratio * 100).toFixed(1)}% → ${(step.alpha.alphaAbove8Ratio * 100).toFixed(1)}% ` +
            `(Δ ${((from(i).alphaAbove8Ratio - step.alpha.alphaAbove8Ratio) * 100).toFixed(1)}pp, meanA ${from(i).meanAlpha} → ${step.alpha.meanAlpha})`,
        );
      });
    }
  }

  const problems = results.filter(
    (r) =>
      r.transparent?.loadError ||
      r.transparent?.pageErrors?.length ||
      r.transparent?.consoleErrors?.length ||
      r.transparent?.failedRequests?.length ||
      r.transparent?.blockedExternal?.length,
  );
  console.log('\n=== 6) anomalies ===');
  if (!problems.length) console.log('none: no load error, page error, console error, failed request or off-host request in either variant');
  for (const r of problems) {
    const t = r.transparent;
    console.log(`${r.mode}: loadError=${t.loadError ?? 'null'} pageErrors=${t.pageErrors.length} consoleErrors=${t.consoleErrors.length} failedRequests=${t.failedRequests.length} blockedExternal=${t.blockedExternal.length}`);
    for (const m of [...t.pageErrors, ...t.consoleErrors, ...t.failedRequests, ...t.blockedExternal].slice(0, 5)) console.log('    ' + m);
  }

  console.log(`\nreport: ${reportPath}`);
  console.log(`shots:  ${OUT}`);
}

main().catch((err) => {
  console.error('[transparency] fatal:', err);
  process.exitCode = 1;
});
