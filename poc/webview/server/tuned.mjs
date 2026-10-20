// tuned.mjs — does a "transparent-friendly" patch actually remove the style's full-screen backing plate?
//
// task-2 follow-up to transparency.mjs. For each of 5 heavy styles (tempera / lumiere / pendolo /
// still / monet) we render the production OBS surface with config.background.transparent=true
// (Folia draws no background layer) AND with one patch applied, then measure how much of the window
// stays painted:
//   - alpha stats from the omitBackground PNG (a0 / partial / full / cov8 / meanA / maxA / 3x3 grid)
//   - "magenta risk": composite every pixel over #FF00FF (the chroma-key colour a real transparent
//     window uses) and count pixels that read magenta-ish, i.e. that a colour-key window would show
//     as pink fringe; computed over all pixels and over partial (0<a<255) pixels only.
//   - the visible painted DOM elements covering >5% of the viewport (who is still drawing).
//
// Patch delivery:
//   - tuning cases send visualizerTunings through the SSE config (server.mjs `tuning=` query param).
//     IMPORTANT: Folia's tuningRegistry `apply` REPLACES the style tuning object wholesale
//     (`apply:(e,t)=>({...e,temperaTuning:t})`) and the visualizer components read plain fields off
//     it, so a partial object would make every omitted field undefined/falsy. We therefore send the
//     FULL default tuning object with only the target field flipped, so each case is a clean
//     single-variable experiment.
//   - still/monet cases inject DOM/CSS at runtime (the patch the product would ship as a CSS rule).
//
// Run: node tuned.mjs   → out/transparency/tuned/<tag>.png + report.json
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18084;
const TOKEN = 'spike-token';
const OUT = path.join(__dirname, 'out', 'transparency', 'tuned');
const PHASE1_OUT = path.join(__dirname, 'out', 'transparency');
const VIEWPORT = { width: 1920, height: 1080 };
const SETTLE_MS = 5000;

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rel = (p) => path.relative(__dirname, p).split(path.sep).join('/');

// ---------------------------------------------------------------------------------------------
// Default tuning objects — copied VERBATIM from poc/webview/dist/dist/assets/noLyricLines-*.js
// (the `N` / `ye` / `ge` literals next to the registry defaults). Folia's SSE path replaces the
// tuning object instead of merging defaults, so these full objects are what keeps the experiment
// free of undefined-field artifacts.
// ---------------------------------------------------------------------------------------------
const DEFAULT_TEMPERA_TUNING = {
  cameraIntensity: 1, glyphMotion: 1, wholeLineLyrics: false, glyphSettleStretch: 0.5, colorMode: 'duo',
  showBlocks: true, showDecor: true, showCornerMarks: true, textInversion: true, layerImages: [],
  layerImageDepth: 'back', layerImageFrequency: 0.6, enableTransitions: true, textureResolution: 1.5,
  postProcessEnabled: true, postProcessTextureCompression: false, postProcessGrain: 0.2,
  postProcessContrast: 0, postProcessRgbShift: 0, postProcessVignette: 0.85, postProcessLensDistortion: 0.3,
};
const DEFAULT_LUMIERE_TUNING = {
  lightIntensity: 1, audioResponse: 1, fogDensity: 1, darkField: 0.75, moteAmount: 1, bloom: 1,
  textBloom: 1, unlitOpacity: 0.22, windowNeighbors: 2, decay: 1, echo: 1, fogOctaves: 5, lineArt: true,
  frontBokeh: true, trails: true, hideTrails: false, seamlessTransitions: true, overlayFrame: true,
  textOnly: false, keywordColors: true, themeIcons: true, themeColorMix: 0.3, renderQuality: 'full',
};
const DEFAULT_PENDOLO_TUNING = {
  arcRadius: 0.42, arcAngleDeg: 100, wheelCenterX: 0, wheelCenterY: 0.5, tickSnappiness: 2,
  activeScale: 1.25, showGearDecor: 'subtle', showCenterGradient: true, showCoverOnWatchFace: false,
  enableLineGlow: false,
};

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------
const CASES = [
  {
    tag: 'tempera-a',
    mode: 'tempera',
    label: 'tempera + {showBlocks:false}',
    tuningMode: 'tempera',
    patchTuning: (d) => ({ ...d, showBlocks: false }),
    note: 'turn off the full-screen 35% paper wash + halftone blocks',
  },
  {
    tag: 'tempera-b',
    mode: 'tempera',
    label: 'tempera + {showBlocks:false, postProcessEnabled:false}',
    tuningMode: 'tempera',
    patchTuning: (d) => ({ ...d, showBlocks: false, postProcessEnabled: false }),
    note: 'also disable the post-process chain (vignette 0.85 / grain 0.2 / lens distortion)',
  },
  {
    tag: 'lumiere-a',
    mode: 'lumiere',
    label: 'lumiere + {darkField:0}',
    tuningMode: 'lumiere',
    patchTuning: (d) => ({ ...d, darkField: 0 }),
    note: 'remove the theme-coloured dark field behind the light',
  },
  {
    tag: 'lumiere-b',
    mode: 'lumiere',
    label: 'lumiere + {darkField:0, bloom:0.5, fogDensity:0.4}',
    tuningMode: 'lumiere',
    patchTuning: (d) => ({ ...d, darkField: 0, bloom: 0.5, fogDensity: 0.4 }),
    note: 'also halve bloom / thin the fog (whether light beams remain a large semi-transparent area)',
  },
  {
    tag: 'pendolo-a',
    mode: 'pendolo',
    label: 'pendolo + {showCenterGradient:false}',
    tuningMode: 'pendolo',
    patchTuning: (d) => ({ ...d, showCenterGradient: false }),
    note: 'remove the centre radial disc; what remains is gear wireframes + text',
  },
  {
    tag: 'still-a',
    mode: 'still',
    label: 'still + CSS (lead spec) html[data-spw-transparent] .visualizer-still > div:first-child {display:none}',
    domPatch: 'still-first-child',
    note: 'does the specified selector hit the vignette, or something else?',
  },
  {
    tag: 'still-a2',
    mode: 'still',
    label: 'still + CSS .visualizer-still div[class*="bg-[radial-gradient"] {display:none}',
    domPatch: 'still-vignette',
    note: 'target the vignette by its gradient class so only the backing plate is removed and the text survives',
  },
  {
    tag: 'still-a3',
    mode: 'still',
    label: 'still + CSS .visualizer-still > div:first-child > div:first-child {display:none}',
    domPatch: 'still-desc',
    note: 'the wrapper inserted by VisualizerShell has display:contents, so the vignette is actually its first child',
  },
  {
    tag: 'monet-a',
    mode: 'monet',
    label: 'monet + hide portrait frame (max [class*=aspect-square], w>400) + drag hanger',
    domPatch: 'monet',
    note: 'is the portrait frame the opaque part? what semi-transparent glow is left',
  },
  {
    // Extra beyond task-2's 8 cases: the same question the earlier brief asked (does a real cover make
    // the portrait frame opaque in a transparent window?). config.coverUrl via server.mjs `cover=1`.
    tag: 'monet-cover',
    mode: 'monet',
    cover: true,
    label: 'monet + real data-URL cover (cover=1), no DOM patch',
    note: 'with a real data-URL cover: does the portrait frame become opaque? how big is the leftover glow',
  },
  {
    tag: 'sonnet-control',
    mode: 'sonnet',
    label: 'sonnet (no patch) — control',
    note: 'unpatched transparent baseline: validates this script against task-1 numbers',
  },
];

const DEFAULTS = { tempera: DEFAULT_TEMPERA_TUNING, lumiere: DEFAULT_LUMIERE_TUNING, pendolo: DEFAULT_PENDOLO_TUNING };

// ---------------------------------------------------------------------------------------------
// PNG analysis
// ---------------------------------------------------------------------------------------------
function r4(v) {
  return Math.round(v * 10000) / 10000;
}

// Alpha histogram over every pixel + 3x3 grid coverage. Same definition as transparency.mjs so the
// control case can be compared numerically with task-1.
function analyzeAlpha(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const total = width * height;
  let a0 = 0;
  let aPartial = 0;
  let a255 = 0;
  let aAbove8 = 0;
  let partialLow = 0; // 0 < a < 128  => the colour key visibly dominates this pixel (pink/purple tint)
  let partialHigh = 0; // 128 <= a < 255 => style colour dominates, key only slightly tints
  let alphaSum = 0;
  let maxAlpha = 0;
  const grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ total: 0, above8: 0 })));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      alphaSum += a;
      if (a > 8) aAbove8++;
      if (a > maxAlpha) maxAlpha = a;
      if (a === 0) a0++;
      else if (a === 255) a255++;
      else {
        aPartial++;
        if (a < 128) partialLow++;
        else partialHigh++;
      }
      const cell = grid[Math.min(2, Math.floor((y / height) * 3))][Math.min(2, Math.floor((x / width) * 3))];
      cell.total++;
      if (a > 8) cell.above8++;
    }
  }
  return {
    width,
    height,
    totalPixels: total,
    alphaZeroRatio: r4(a0 / total),
    alphaPartialRatio: r4(aPartial / total),
    alphaFullRatio: r4(a255 / total),
    alphaAbove8Ratio: r4(aAbove8 / total),
    // Split of the semi-transparent area by who dominates the pixel: low alpha = the chroma key shows
    // through as a visible magenta/pink wash, high alpha = the style's own colour only gets tinted.
    alphaPartialLowRatio: r4(partialLow / total),
    alphaPartialHighRatio: r4(partialHigh / total),
    meanAlpha: Math.round((alphaSum / total) * 10) / 10,
    maxAlpha,
    gridAbove8Ratio: grid.map((row) => row.map((c) => r4(c.above8 / c.total))),
  };
}

// Run the actual colour-key test: composite the RGBA PNG over #FF00FF, then count pixels that read
// magenta-ish. A colour-key transparent window fills its "transparent" area with magenta; any pixel
// that is only partly transparent blends with it, so these ratios are a direct estimate of the area
// that would look pink-polluted on screen. `pink` uses the task's threshold ((r-g)>40 && (b-g)>40),
// `strongPink` a sharper one ((r-g)>80 && (b-g)>80).
function analyzeMagenta(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const total = width * height;
  let pink = 0;
  let strongPink = 0;
  let partial = 0;
  let pinkPartial = 0;
  let strongPinkPartial = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const af = a / 255;
    const r = data[i] * af + 255 * (1 - af);
    const g = data[i + 1] * af;
    const b = data[i + 2] * af + 255 * (1 - af);
    const isPink = r - g > 40 && b - g > 40;
    const isStrong = r - g > 80 && b - g > 80;
    if (isPink) pink++;
    if (isStrong) strongPink++;
    if (a !== 0 && a !== 255) {
      partial++;
      if (isPink) pinkPartial++;
      if (isStrong) strongPinkPartial++;
    }
  }
  return {
    // Raw share of the window whose colour-key composite reads magenta-ish. NOTE this is dominated by
    // fully transparent pixels (composited key == pure #FF00FF), so it is NOT a pollution measure —
    // it is kept because it was the requested metric; use the *KeyArea numbers for judgement.
    pinkRatio: r4(pink / total),
    strongPinkRatio: r4(strongPink / total),
    // Fraction of the WINDOW that is both semi-transparent and reads magenta after compositing: this is
    // the area a colour-key window would actually show as a pink/purple wash (the real risk number).
    pinkKeyAreaRatio: r4(pinkPartial / total),
    strongPinkKeyAreaRatio: r4(strongPinkPartial / total),
    // Same, restricted to partially transparent pixels (how polluted the semi-transparent area is).
    partialPixels: partial,
    pinkRatioOverPartial: partial ? r4(pinkPartial / partial) : 0,
    strongPinkRatioOverPartial: partial ? r4(strongPinkPartial / partial) : 0,
  };
}

// Alpha stats restricted to a DOM rect (used for "is the monet portrait frame opaque?").
function analyzeRegionAlpha(file, rect) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(width, Math.round(rect.x + rect.w));
  const y1 = Math.min(height, Math.round(rect.y + rect.h));
  let total = 0;
  let a0 = 0;
  let aPartial = 0;
  let aFull = 0;
  let above8 = 0;
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = data[(y * width + x) * 4 + 3];
      total++;
      sum += a;
      if (a === 0) a0++;
      else if (a === 255) aFull++;
      else aPartial++;
      if (a > 8) above8++;
    }
  }
  return {
    rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    pixels: total,
    alphaZeroRatio: r4(a0 / total),
    alphaPartialRatio: r4(aPartial / total),
    alphaFullRatio: r4(aFull / total),
    alphaAbove8Ratio: r4(above8 / total),
    meanAlpha: Math.round((sum / total) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------------------------
// DOM evidence
// ---------------------------------------------------------------------------------------------
// Visible painted elements covering >5% of the viewport, biggest first (max 6). Who is still drawing?
function collectPainted(page) {
  return page.evaluate(() => {
    const painted = (el) => {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor || '';
      const hasBg = bg !== '' && bg !== 'transparent' && !/^rgba\(0, 0, 0, 0\)$/.test(bg);
      const hasImg = cs.backgroundImage !== 'none';
      const isCanvas = el.tagName === 'CANVAS';
      const hasFilter = cs.filter && cs.filter !== 'none';
      const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
      return hasBg || hasImg || isCanvas || hasFilter || hasShadow;
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const area = vw * vh;
    const out = [];
    for (const el of document.querySelectorAll('#root *')) {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const cover = (w * h) / area;
      if (cover < 0.05) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) <= 0.01) continue;
      if (!painted(el)) continue;
      const cls = typeof el.className === 'string' ? el.className : el.className?.baseVal ?? '';
      out.push({
        tag: el.tagName.toLowerCase(),
        class: cls.slice(0, 120),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        cover: Math.round(cover * 10000) / 10000,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage.slice(0, 120),
        opacity: cs.opacity,
        filter: cs.filter,
        isCanvas: el.tagName === 'CANVAS',
        bitmap: el.tagName === 'CANVAS' ? `${el.width}x${el.height}` : null,
      });
    }
    out.sort((a, b) => b.cover - a.cover);
    return out.slice(0, 6);
  });
}

// still: prove which node is the vignette and how many nodes each candidate rule hits.
function inspectStill(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.visualizer-still');
    const kids = shell ? [...shell.children] : [];
    const str = (e) => (typeof e.className === 'string' ? e.className : e.className?.baseVal ?? '');
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    // The vignette node itself, plus where it sits relative to .visualizer-still (the shell wraps its
    // children in a <div style="display:contents">, so it is NOT a direct child of the shell).
    const vig = document.querySelector('.visualizer-still div[class*="bg-[radial-gradient"]');
    let depth = null;
    if (vig) {
      depth = 0;
      for (let cur = vig; cur && cur !== shell; cur = cur.parentElement) depth++;
    }
    return {
      shellFound: !!shell,
      shellClass: shell ? str(shell).slice(0, 160) : null,
      childCount: kids.length,
      children: kids.slice(0, 8).map((el, i) => ({
        index: i,
        tag: el.tagName.toLowerCase(),
        className: str(el).slice(0, 120),
        display: getComputedStyle(el).display,
        rect: rect(el),
        descendantCount: el.querySelectorAll('*').length,
        containsVignette: !!el.querySelector('div[class*="bg-[radial-gradient"]'),
      })),
      vignette: vig
        ? { className: str(vig).slice(0, 160), depthBelowShell: depth, rect: rect(vig), opacity: getComputedStyle(vig).opacity, backgroundImage: getComputedStyle(vig).backgroundImage.slice(0, 160) }
        : null,
      // Which candidate selectors the product could actually ship, and what they hit.
      hitCounts: {
        'shell > div:first-child': document.querySelectorAll('.visualizer-still > div:first-child').length,
        'shell > div:first-child > div:first-child': document.querySelectorAll('.visualizer-still > div:first-child > div:first-child').length,
        'shell div[class*="bg-[radial-gradient"]': document.querySelectorAll('.visualizer-still div[class*="bg-[radial-gradient"]').length,
        'doc div[class*="bg-[radial-gradient"]': document.querySelectorAll('div[class*="bg-[radial-gradient"]').length,
      },
    };
  });
}

function inspectMonet(page) {
  return page.evaluate(() => {
    const str = (e) => (typeof e.className === 'string' ? e.className : e.className?.baseVal ?? '');
    const cands = [...document.querySelectorAll('[class*="aspect-square"]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, cls: str(el) };
      })
      .filter((c) => c.rect.w > 400 && c.rect.h > 400)
      .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
    const hangers = [...document.querySelectorAll('[class*="-top-3"][class*="right-8"]')];
    return {
      aspectSquareCandidates: cands.slice(0, 4).map((c) => ({ class: c.cls.slice(0, 120), rect: c.rect })),
      hangerCount: hangers.length,
      hangerClasses: hangers.slice(0, 4).map((e) => str(e).slice(0, 120)),
      biggest: cands.length ? { class: cands[0].cls.slice(0, 120), rect: cands[0].rect } : null,
    };
  });
}

// Apply the DOM patch. Returns hit counts, and the rect that was hidden (for region alpha stats).
async function applyDomPatch(page, kind) {
  if (kind.startsWith('still')) {
    const rules = {
      'still-first-child': 'html[data-spw-transparent="true"] .visualizer-still > div:first-child { display: none !important; }',
      'still-vignette': 'html[data-spw-transparent="true"] .visualizer-still div[class*="bg-[radial-gradient"] { display: none !important; }',
      'still-desc': 'html[data-spw-transparent="true"] .visualizer-still > div:first-child > div:first-child { display: none !important; }',
    };
    const cssRule = rules[kind];
    await page.evaluate(() => {
      document.documentElement.dataset.spwTransparent = 'true';
    });
    await page.addStyleTag({ content: cssRule });
    return page.evaluate((rule) => {
      const str = (e) => (typeof e.className === 'string' ? e.className : e.className?.baseVal ?? '');
      const sel = rule.replace('html[data-spw-transparent="true"] ', '').replace(' { display: none !important; }', '');
      const hits = [...document.querySelectorAll(sel)];
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        cssRule: rule,
        selector: sel,
        ruleTargetHits: hits.length,
        targetDetail: hits.slice(0, 4).map((el) => ({
          tag: el.tagName.toLowerCase(),
          className: str(el).slice(0, 160),
          display: getComputedStyle(el).display,
          rect: rect(el),
        })),
        textStillVisible: (() => {
          // Is the lyric text (a sibling layer) still painted? Count visible text-ish descendants.
          const shell = document.querySelector('.visualizer-still');
          if (!shell) return null;
          let visible = 0;
          for (const el of shell.querySelectorAll('div')) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if ((el.textContent || '').trim().length > 0 && el.children.length === 0) visible++;
          }
          return visible;
        })(),
      };
    }, cssRule);
  }
  if (kind === 'monet') {
    return page.evaluate(() => {
      const str = (e) => (typeof e.className === 'string' ? e.className : e.className?.baseVal ?? '');
      const cands = [...document.querySelectorAll('[class*="aspect-square"]')]
        .map((el) => { const r = el.getBoundingClientRect(); return { el, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, cls: str(el) }; })
        .filter((c) => c.rect.w > 400 && c.rect.h > 400)
        .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
      const hangers = [...document.querySelectorAll('[class*="-top-3"][class*="right-8"]')];
      let hiddenFrame = null;
      let hiddenFrameRect = null;
      if (cands.length) {
        hiddenFrame = cands[0].cls.slice(0, 120);
        hiddenFrameRect = cands[0].rect;
        cands[0].el.style.display = 'none';
      }
      for (const h of hangers) h.style.display = 'none';
      return {
        hiddenFrame,
        hiddenFrameRect,
        frameHits: cands.length,
        hangerHits: hangers.length,
      };
    });
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Server/browser plumbing
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

async function captureCase(browser, c) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 400));
  });
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 400)));
  page.on('requestfailed', (req) => failedRequests.push(`${req.url().slice(0, 160)} :: ${req.failure()?.errorText ?? '?'}`));

  const tuning = c.tuningMode ? { [c.tuningMode]: c.patchTuning(DEFAULTS[c.tuningMode]) } : null;

  // The OBS surface builds its EventSource URL with only ?token= (see yje() in the Folia bundle), so
  // mode/tuning must be injected on the SSE request itself, exactly like transparency.mjs does.
  await page.route('**/obs/events*', async (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('mode', c.mode);
    u.searchParams.set('transparent', '1');
    if (tuning) u.searchParams.set('tuning', JSON.stringify(tuning));
    if (c.cover) u.searchParams.set('cover', '1');
    await route.continue({ url: u.toString() });
  });

  const shot = path.join(OUT, `${c.tag}.png`);
  const beforeShot = c.domPatch ? path.join(OUT, `${c.tag}-before.png`) : null;
  const result = {
    tag: c.tag,
    mode: c.mode,
    label: c.label,
    note: c.note || null,
    tuning: tuning ? tuning[c.tuningMode] : null,
    screenshot: rel(shot),
    beforeScreenshot: beforeShot ? rel(beforeShot) : null,
    loadError: null,
    domPatch: null,
    domInspect: null,
    alpha: null,
    beforeAlpha: null,
    magenta: null,
    beforeMagenta: null,
    region: null,
    painted: null,
    consoleErrors,
    pageErrors,
    failedRequests,
  };

  try {
    await page.goto(`http://127.0.0.1:${PORT}/?obs=1&token=${TOKEN}`, { waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForSelector('canvas', { timeout: 12000 });
    } catch {
      // DOM-only styles (still / classic / partita / tilt / claddagh / cappella) have no canvas.
    }
    await sleep(SETTLE_MS);

    if (c.domPatch?.startsWith('still')) result.domInspect = await inspectStill(page);
    if (c.domPatch === 'monet' || c.cover) result.domInspect = await inspectMonet(page);

    if (beforeShot) {
      await page.screenshot({ path: beforeShot, omitBackground: true, fullPage: false });
      result.beforeAlpha = analyzeAlpha(beforeShot);
      result.beforeMagenta = analyzeMagenta(beforeShot);
      if (c.domPatch === 'monet' && result.domInspect?.biggest) {
        result.regionBefore = analyzeRegionAlpha(beforeShot, result.domInspect.biggest.rect);
      }
    }

    if (c.domPatch) {
      result.domPatch = await applyDomPatch(page, c.domPatch);
      await sleep(400); // let the DOM patch paint one frame before the shot
    }

    await page.screenshot({ path: shot, omitBackground: true, fullPage: false });
    result.alpha = analyzeAlpha(shot);
    result.magenta = analyzeMagenta(shot);
    if ((c.domPatch === 'monet' || c.cover) && (result.domPatch?.hiddenFrameRect || result.domInspect?.biggest?.rect)) {
      result.regionAfter = analyzeRegionAlpha(shot, result.domPatch?.hiddenFrameRect ?? result.domInspect.biggest.rect);
    }
    result.painted = await collectPainted(page);
    result.runtimeDom = await page.evaluate(() => ({
      visualizerStillChildren: document.querySelectorAll('.visualizer-still > div').length,
      firstChildRuleHits: document.querySelectorAll('html[data-spw-transparent="true"] .visualizer-still > div:first-child').length,
    }));
  } catch (err) {
    result.loadError = String(err).slice(0, 600);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Grading + reporting
// ---------------------------------------------------------------------------------------------
// Reference levels: classic (DOM text only) cov8 = 3.5% and sonnet (lyrics + halo) cov8 = 20.8% from
// task-1. The sonnet control is re-measured in this same run, so the "acceptable" ceiling tracks the
// actual current sonnet number instead of a hard-coded constant.
const CLASSIC_COV8 = 0.035;
function grade(cov8, pinkKeyArea, sonnetCov8) {
  const ceiling = Math.max(0.12, (sonnetCov8 ?? 0.21) * 1.15);
  if (cov8 <= 0.06) return { level: 'text-only', label: `只剩文字/线框（cov8 ${(cov8 * 100).toFixed(1)}% ≈ classic ${(CLASSIC_COV8 * 100).toFixed(1)}%）` };
  if (cov8 <= ceiling) {
    return {
      level: 'text-halo',
      label: `接近 sonnet 水平（文字+光晕，可接受；cov8 ${(cov8 * 100).toFixed(1)}% ≤ 阈值 ${(ceiling * 100).toFixed(1)}%）`,
    };
  }
  if (cov8 <= 0.5) return { level: 'partial-plate', label: `仍有明显半透明底板（cov8 ${(cov8 * 100).toFixed(1)}% > ${(ceiling * 100).toFixed(1)}%）` };
  return { level: 'unusable', label: `底板基本未消除（cov8 ${(cov8 * 100).toFixed(1)}%）` };
}

const CELL_NAMES = [
  ['tl', 'tc', 'tr'],
  ['ml', 'mc', 'mr'],
  ['bl', 'bc', 'br'],
];
function gridString(grid) {
  const hot = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (grid[y][x] >= 0.02) hot.push(`${CELL_NAMES[y][x]} ${(grid[y][x] * 100).toFixed(1)}%`);
  return hot.length ? hot.join(', ') : 'none (<2% everywhere)';
}

// Task-1 transparent baselines, read from the phase-1 report so every delta is computed, not recalled.
function loadBaselines() {
  const base = {};
  const reportPath = path.join(PHASE1_OUT, 'report.json');
  if (!fs.existsSync(reportPath)) return base;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const row of report.results) {
    const t = row.transparent;
    if (!t?.alpha) continue;
    base[row.mode] = { alpha: t.alpha, screenshot: t.screenshot };
  }
  return base;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const baselines = loadBaselines();
  const child = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  const results = [];
  try {
    await waitForServer(child);
    browser = await chromium.launch({
      channel: 'msedge',
      headless: true,
      args: ['--window-size=1920,1080', '--hide-scrollbars', '--disable-gpu-vsync'],
    });
    for (const c of CASES) {
      process.stdout.write(`[tuned] ${c.tag} (${c.mode}) ... `);
      const row = await captureCase(browser, c);
      results.push(row);
      console.log(
        row.alpha
          ? `cov8=${(row.alpha.alphaAbove8Ratio * 100).toFixed(1)}% meanA=${row.alpha.meanAlpha} pinkKeyArea=${(row.magenta.pinkKeyAreaRatio * 100).toFixed(1)}%`
          : `FAILED (${row.loadError})`,
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    child.kill('SIGKILL');
  }

  // Attach baselines + deltas + verdicts (not stored in the capture row: keeps report readable).
  const out = { generatedAt, port: PORT, viewport: VIEWPORT, settleMs: SETTLE_MS, token: TOKEN, cases: [] };
  const pad = (v, n) => String(v).padEnd(n);
  const padl = (v, n) => String(v).padStart(n);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  // The sonnet control (unpatched, same pipeline) sets the "acceptable residual" ceiling, so the
  // verdicts are relative to today's measurement rather than a hard-coded number.
  const sonnetRow = results.find((r) => r.mode === 'sonnet');
  const sonnetCov8 = sonnetRow?.alpha?.alphaAbove8Ratio ?? null;

  for (const r of results) {
    const base = baselines[r.mode] ? { alpha: baselines[r.mode].alpha, screenshot: baselines[r.mode].screenshot } : null;
    let basePink = null;
    if (baselines[r.mode]?.screenshot) {
      const p = path.join(__dirname, baselines[r.mode].screenshot);
      if (fs.existsSync(p)) basePink = analyzeMagenta(p);
    }
    const g = r.alpha
      ? grade(r.alpha.alphaAbove8Ratio, r.magenta.pinkKeyAreaRatio, sonnetCov8)
      : { level: 'error', label: '无法测量' };
    const entry = {
      ...r,
      baseline: base
        ? {
            cov8: base.alpha.alphaAbove8Ratio,
            meanAlpha: base.alpha.meanAlpha,
            alphaFullRatio: base.alpha.alphaFullRatio,
            pink: basePink ? basePink.pinkRatio : null,
            pinkKeyArea: basePink ? basePink.pinkKeyAreaRatio : null,
            screenshot: base.screenshot,
          }
        : null,
      delta: r.alpha && base
        ? {
            cov8: Math.round((r.alpha.alphaAbove8Ratio - base.alpha.alphaAbove8Ratio) * 10000) / 10000,
            meanAlpha: Math.round((r.alpha.meanAlpha - base.alpha.meanAlpha) * 10) / 10,
            pinkKeyArea: basePink ? Math.round((r.magenta.pinkKeyAreaRatio - basePink.pinkKeyAreaRatio) * 10000) / 10000 : null,
          }
        : null,
      verdict: g,
    };
    out.cases.push(entry);
  }
  out.sonnetCeiling = sonnetCov8;
  out.method = {
    knobDelivery: 'OBS surface builds its EventSource URL with only ?token=, so mode/transparent/tuning are injected by rewriting the /obs/events request URL with page.route() (server.mjs reads them from the SSE query).',
    tuningCompleteness:
      'Full default tuning objects (copied from the dist literals) with only the target field flipped, because Folia\'s tuningRegistry apply replaces the tuning object instead of merging defaults; a partial object would leave fields undefined.',
    magenta:
      'Each PNG pixel composited over #FF00FF (the chroma-key colour of a real transparent window); pink = (r-g)>40 && (b-g)>40, strongPink = (r-g)>80 && (b-g)>80. pinkRatio over ALL pixels is mostly the empty (alpha=0) area, so it is NOT a pollution measure; pinkKeyAreaRatio = pink AND 0<alpha<255 over the whole window = the area a key-coloured window would visibly tint; pinkRatioOverPartial is the same restricted to semi-transparent pixels.',
    verdictRule:
      'cov8 ≤ 6% = text/frame only; cov8 ≤ max(12%, 1.15×sonnetControl) = acceptable (text + halo); ≤50% = still a plate; above that = unusable. The sonnet control is re-measured in this same run so the ceiling is live.',
    baseline: 'phase-1 unpatched transparent shots from out/transparency/report.json + the same magenta metric computed on those PNGs.',
  };
  const reportPath = path.join(OUT, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));

  // --- table 1: patched residual coverage ---
  console.log('\n=== 1) patched transparent shot: residual coverage of 1920x1080 ===');
  console.log(
    pad('case', 16) + pad('mode', 8) + padl('a0', 7) + padl('partial', 8) + padl('full', 6) + padl('cov8', 7) +
      padl('meanA', 7) + padl('maxA', 6) + padl('key8', 7) + padl('baseCov8', 9) + padl('Δcov8', 7) + '  verdict',
  );
  for (const r of out.cases) {
    if (!r.alpha) {
      console.log(pad(r.tag, 16) + pad(r.mode, 8) + 'FAILED: ' + r.loadError);
      continue;
    }
    console.log(
      pad(r.tag, 16) + pad(r.mode, 8) +
        padl(pct(r.alpha.alphaZeroRatio), 7) + padl(pct(r.alpha.alphaPartialRatio), 8) + padl(pct(r.alpha.alphaFullRatio), 6) +
        padl(pct(r.alpha.alphaAbove8Ratio), 7) + padl(r.alpha.meanAlpha, 7) + padl(r.alpha.maxAlpha, 6) +
        padl(pct(r.magenta.pinkKeyAreaRatio), 7) +
        padl(r.baseline ? pct(r.baseline.cov8) : '-', 9) + padl(r.delta ? pct(r.delta.cov8) : '-', 7) +
        '  ' + r.verdict.label,
    );
  }

  // --- table 2: 3x3 grid ---
  console.log('\n=== 2) 3x3 grid a>8 coverage (patched) ===');
  for (const r of out.cases) {
    if (!r.alpha) continue;
    console.log(pad(r.tag, 16) + gridString(r.alpha.gridAbove8Ratio));
  }

  // --- table 3: magenta (colour-key) risk ---
  // pinkRatio over all pixels is dominated by the fully transparent area (composited #FF00FF), so the
  // actionable number is pinkKeyAreaRatio = magenta-tinted semi-transparent pixels as a share of the whole
  // window; that is the area a real chroma-key window shows as pink fringing.
  console.log('\n=== 3) colour-key magenta risk (composite over #FF00FF) ===');
  console.log(
    pad('case', 16) + padl('pink/partial', 13) + padl('keyA%', 8) + padl('strongKeyA%', 13) +
      padl('baseKeyA%', 10) + padl('ΔkeyA', 8) + padl('allPixPink', 12),
  );
  for (const r of out.cases) {
    if (!r.magenta) continue;
    console.log(
      pad(r.tag, 16) + padl(pct(r.magenta.pinkRatioOverPartial), 13) + padl(pct(r.magenta.pinkKeyAreaRatio), 8) +
        padl(pct(r.magenta.strongPinkKeyAreaRatio), 13) +
        padl(r.baseline?.pinkKeyArea != null ? pct(r.baseline.pinkKeyArea) : '-', 10) +
        padl(r.delta?.pinkKeyArea != null ? pct(r.delta.pinkKeyArea) : '-', 8) +
        padl(pct(r.magenta.pinkRatio), 12),
    );
  }

  // --- table 4: who still draws ---
  console.log('\n=== 4) remaining painted elements covering >5% of the viewport (top 3) ===');
  for (const r of out.cases) {
    if (!r.painted) continue;
    console.log(`${r.tag}:`);
    if (!r.painted.length) console.log('   none');
    for (const p of r.painted.slice(0, 3)) {
      console.log(`   ${pct(p.cover).padStart(6)}  ${p.tag}.${p.class.slice(0, 60)}  rect=${p.rect.w}x${p.rect.h}@${p.rect.x},${p.rect.y}  bg=${p.backgroundColor}${p.isCanvas ? `  canvas=${p.bitmap}` : ''}`);
    }
  }

  // --- still / monet DOM checks ---
  for (const r of out.cases) {
    if (r.tag.startsWith('still')) {
      console.log('\n=== 5) still DOM check (' + r.tag + ') ===');
      if (r.tag === 'still-a') {
        console.log('shellFound=' + r.domInspect?.shellFound + ' childCount=' + r.domInspect?.childCount +
          ' shellClass=' + r.domInspect?.shellClass);
        for (const ch of r.domInspect?.children ?? []) {
          console.log(`   child[${ch.index}] ${ch.tag} display=${ch.display} rect=${ch.rect.w}x${ch.rect.h} desc=${ch.descendantCount} class="${ch.className}"`);
        }
        console.log('vignette=' + JSON.stringify(r.domInspect?.vignette));
        console.log('hitCounts=' + JSON.stringify(r.domInspect?.hitCounts));
      }
      console.log('rule="' + r.domPatch?.cssRule + '"');
      console.log('   selectorHits=' + r.domPatch?.ruleTargetHits + ' targets=' + JSON.stringify(r.domPatch?.targetDetail));
      console.log('   lyricTextNodesVisible=' + r.domPatch?.textStillVisible);
      if (r.beforeAlpha) {
        console.log('before: cov8=' + pct(r.beforeAlpha.alphaAbove8Ratio) + ' meanA=' + r.beforeAlpha.meanAlpha + ' keyA=' + pct(r.beforeMagenta.pinkKeyAreaRatio));
        console.log('after : cov8=' + pct(r.alpha.alphaAbove8Ratio) + ' meanA=' + r.alpha.meanAlpha + ' keyA=' + pct(r.magenta.pinkKeyAreaRatio));
      }
    }
    if (r.tag === 'monet-a' || r.tag === 'monet-cover') {
      console.log('\n=== 6) monet DOM check (' + r.tag + ') ===');
      console.log('aspectSquare candidates=' + JSON.stringify(r.domInspect?.aspectSquareCandidates ?? []));
      console.log('hiddenFrame=' + r.domPatch?.hiddenFrame + ' frameHits=' + r.domPatch?.frameHits + ' hangerHits=' + r.domPatch?.hangerHits);
      if (r.regionBefore) console.log('frame region BEFORE hide: full=' + pct(r.regionBefore.alphaFullRatio) + ' partial=' + pct(r.regionBefore.alphaPartialRatio) + ' meanA=' + r.regionBefore.meanAlpha);
      if (r.regionAfter) console.log('frame region AFTER shot : full=' + pct(r.regionAfter.alphaFullRatio) + ' partial=' + pct(r.regionAfter.alphaPartialRatio) + ' meanA=' + r.regionAfter.meanAlpha);
      if (r.beforeAlpha) console.log('before: cov8=' + pct(r.beforeAlpha.alphaAbove8Ratio) + ' meanA=' + r.beforeAlpha.meanAlpha + ' keyA=' + pct(r.beforeMagenta.pinkKeyAreaRatio));
    }
  }

  const errors = out.cases.filter((r) => r.loadError || r.consoleErrors.length || r.pageErrors.length || r.failedRequests.length);
  console.log('\n=== 7) anomalies ===');
  if (!errors.length) console.log('none — all 8 cases loaded, no console/page errors, no failed requests');
  else for (const e of errors) console.log(`${e.tag}: loadError=${e.loadError} console=${e.consoleErrors.length} page=${e.pageErrors.length} failedReq=${e.failedRequests.length}`);

  console.log('\nscreenshots + report: ' + OUT);
  console.log('report: ' + reportPath);
}

main().catch((err) => {
  console.error('[tuned] fatal', err);
  process.exitCode = 1;
});
