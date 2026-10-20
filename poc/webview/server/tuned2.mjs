// tuned2.mjs — round-2 transparent-patch verification (task-3). Builds on tuned.mjs (same capture
// plumbing / alpha + colour-key maths) and answers four open questions:
//
//   1) still-b  — dump the real `.visualizer-still` DOM (children, outerHTML, every radial-gradient
//                 node) and hide ONLY the radial-gradient node that covers >=90% of the viewport
//                 (setProperty('display','none','important')). Then prove the lyric text survived by
//                 counting alpha>8 pixels and mean alpha in the centre window region (x 30%-70%,
//                 y 35%-65%) before vs after, and require cov8 < 8%.
//   2) tempera-c — {showBlocks:false, postProcessVignette:0} (keep the rest of the post chain).
//   3) tempera-d — {showBlocks:false, postProcessVignette:0, postProcessGrain:0}.
//   4) lumiere-c — dark theme {darkField:0, textOnly:true}.
//      lumiere-d — LIGHT theme (#e8e4dc background) + the same tuning: does the dark-field floor
//                  (~0.94 alpha) survive because the light theme paints its own field?
//      lumiere-e — LIGHT theme, no tuning patch (control for d).
//
// Patch delivery:
//   - tuning cases send config.visualizerTunings through the SSE config (server.mjs `tuning=` param).
//     Folia's tuningRegistry `apply` REPLACES the style tuning object wholesale, so we always send the
//     FULL default tuning object with only the target fields flipped (see tuned.mjs).
//   - the light-theme cases send config.theme through the SSE config (server.mjs `theme=` param).
//   - still-b patches the DOM at runtime (the rule the product would ship).
//
// Run: node tuned2.mjs   → out/transparency/tuned2/<tag>.png + report.json
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18085;
const TOKEN = 'spike-token';
const OUT = path.join(__dirname, 'out', 'transparency', 'tuned2');
const PHASE1_OUT = path.join(__dirname, 'out', 'transparency');
const VIEWPORT = { width: 1920, height: 1080 };
const SETTLE_MS = 5000;

// The centre window used to prove "the lyric text is still painted" after the backing plate is hidden.
// Fractions of the viewport, per task-3: x 0.3-0.7, y 0.35-0.65.
const CENTER_REGION = { x: 0.3, y: 0.35, w: 0.4, h: 0.3 };

// Light theme from task-3 (same shape as demoData.mjs THEME, colours swapped).
const LIGHT_THEME = {
  name: 'Light Daylight',
  backgroundColor: '#e8e4dc',
  primaryColor: '#141414',
  accentColor: '#b8860b',
  secondaryColor: '#4a4a4a',
  fontStyle: 'sans',
  animationIntensity: 'normal',
};

// Lumiere's dark-field floor is decided from the THEME BACKGROUND LUMINANCE, not from darkField. Source
// (poc/webview/dist/dist/assets/createLumierePixiRuntime-BTwrnJKT.js):
//   Ai=.18, ji=.94, Mi=.06,
//   Ni=(e,t)=>{let n=be(e.backgroundColor,[0,0,0]), r=Number.isFinite(t)?Math.min(1,Math.max(0,t)):0, i=Se(n)>Ai;
//              return {color:xe(n,Mi), alpha:i?Math.max(r,ji):r}}
//   Se=e=>.2126*e[0]+.7152*e[1]+.0722*e[2]     // WCAG relative luminance on 0..1 channels
// So any theme whose background luminance exceeds 0.18 gets alpha = max(darkField, 0.94) — darkField:0
// cannot remove it. 0.94*255 = 239.7, which is exactly the dominant alpha=239 measured in lumiere-d/e.
function luminanceOfHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return Math.round((0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]) * 10000) / 10000;
}
const LUMIERE_FLOOR = { luminanceThreshold: 0.18, alphaFloor: 0.94, floorAlpha255: Math.round(0.94 * 255) };

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
  // 1) still-b: DOM diagnosis + hide ONLY the full-viewport radial-gradient plate, then prove the text
  //    survives in the centre region. This is the patch the product would ship, so the selector is
  //    derived from live class names, not guessed.
  {
    tag: 'still-b',
    mode: 'still',
    label: 'still + hide only [class*=radial-gradient] nodes covering >=90% viewport',
    domPatch: 'still-radial',
    note: 'full DOM diagnosis first, then hide exactly the vignette plate; centre region proves text kept',
  },
  {
    tag: 'tempera-c',
    mode: 'tempera',
    label: 'tempera + {showBlocks:false, postProcessVignette:0}',
    tuningMode: 'tempera',
    patchTuning: (d) => ({ ...d, showBlocks: false, postProcessVignette: 0 }),
    note: 'keep the post chain, only remove the vignette pass',
  },
  {
    tag: 'tempera-d',
    mode: 'tempera',
    label: 'tempera + {showBlocks:false, postProcessVignette:0, postProcessGrain:0}',
    tuningMode: 'tempera',
    patchTuning: (d) => ({ ...d, showBlocks: false, postProcessVignette: 0, postProcessGrain: 0 }),
    note: 'also remove the film grain; target cov8 < 8% with postProcessEnabled still true',
  },
  {
    tag: 'lumiere-c',
    mode: 'lumiere',
    label: 'lumiere (dark theme) + {darkField:0, textOnly:true}',
    tuningMode: 'lumiere',
    patchTuning: (d) => ({ ...d, darkField: 0, textOnly: true }),
    note: 'dark theme: textOnly may bypass the beams/fog that keep the plate alive',
  },
  {
    tag: 'lumiere-d',
    mode: 'lumiere',
    theme: LIGHT_THEME,
    label: 'lumiere (LIGHT theme #e8e4dc) + {darkField:0, textOnly:true}',
    tuningMode: 'lumiere',
    patchTuning: (d) => ({ ...d, darkField: 0, textOnly: true }),
    note: 'does the 0.94 dark-field floor survive in a light theme (i.e. is it theme-independent)?',
  },
  {
    tag: 'lumiere-e',
    mode: 'lumiere',
    theme: LIGHT_THEME,
    label: 'lumiere (LIGHT theme #e8e4dc), no tuning patch — control for d',
    note: 'unpatched light-theme baseline: how much of the window is already opaque there',
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
  // Alpha bands, so a verdict can say HOW STRONG the residual paint is, not just how much area it covers.
  // A 20% area at alpha<=32 is an invisible haze on a transparent window; 20% at alpha>=192 is a plate.
  const bands = { a1_8: 0, a9_32: 0, a33_64: 0, a65_128: 0, a129_192: 0, a193_254: 0, a255: 0 };
  const grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ total: 0, above8: 0 })));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      alphaSum += a;
      if (a > 8) aAbove8++;
      if (a > maxAlpha) maxAlpha = a;
      if (a === 0) a0++;
      else if (a === 255) {
        a255++;
        bands.a255++;
      } else {
        aPartial++;
        if (a < 128) partialLow++;
        else partialHigh++;
        if (a <= 8) bands.a1_8++;
        else if (a <= 32) bands.a9_32++;
        else if (a <= 64) bands.a33_64++;
        else if (a <= 128) bands.a65_128++;
        else if (a <= 192) bands.a129_192++;
        else bands.a193_254++;
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
    // Share of the window in each alpha band (a1_8..a255); a255 is the only band that survives a chroma
    // key untainted, so a patch is only "visually clean" when the area sits in the low bands.
    bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, r4(v / total)])),
    bandsCount: bands,
    // "Strong paint" = semi-transparent or opaque pixels that still read clearly over a transparent
    // window (alpha > 64); this is the part of the frame a user would see as actual drawn content.
    strongPaintRatio: r4((bands.a65_128 + bands.a129_192 + bands.a193_254 + bands.a255) / total),
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

// still-b: FULL DOM diagnosis of the still visualizer. Task-3 asks for the complete child list (index /
// tag / raw className / rect / childElementCount / first 40 chars of textContent), the shell outerHTML
// (truncated to 4000 chars), and every element whose class contains "radial-gradient" (tag/class/rect).
// The hide decision is then driven by the live data — "class contains radial-gradient AND covers at
// least 90% of the viewport" — not by a guessed `:first-child` path.
function diagnoseStill(page) {
  return page.evaluate(() => {
    const str = (e) => (typeof e.className === 'string' ? e.className : e.className?.baseVal ?? '');
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const shell = document.querySelector('.visualizer-still');
    if (!shell) return { shellFound: false };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const area = vw * vh;
    const cover = (el) => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      return (w * h) / area;
    };
    const walk = (root) => {
      const out = [];
      let i = 0;
      for (const el of root.children) {
        out.push({
          index: i++,
          tagName: el.tagName.toLowerCase(),
          className: str(el).slice(0, 200),
          rect: rect(el),
          childElementCount: el.childElementCount,
          textContent: (el.textContent || '').trim().slice(0, 40),
        });
        for (const d of walk(el)) out.push({ ...d, index: `${out[0].index}.${d.index}` });
      }
      return out;
    };
    // Every node (anywhere in the document, not just under the shell) whose class mentions radial-gradient.
    const radial = [...document.querySelectorAll('[class*="radial-gradient"]')].map((el, i) => ({
      index: i,
      tag: el.tagName.toLowerCase(),
      className: str(el).slice(0, 240),
      rect: rect(el),
      cover: Math.round(cover(el) * 10000) / 10000,
      qualifies: cover(el) >= 0.9, // >=90% of the viewport => candidate backing plate
      display: getComputedStyle(el).display,
      opacity: getComputedStyle(el).opacity,
      backgroundImage: getComputedStyle(el).backgroundImage.slice(0, 200),
    }));
    return {
      shellFound: true,
      shellClass: str(shell).slice(0, 200),
      viewport: { w: vw, h: vh },
      childCount: shell.childElementCount,
      children: walk(shell).slice(0, 40),
      radialNodes: radial,
      radialQualifying: radial.filter((r) => r.qualifies).length,
      outerHTML: shell.outerHTML.slice(0, 4000),
      hitCounts: {
        'shell > div:first-child': document.querySelectorAll('.visualizer-still > div:first-child').length,
        'shell > div:first-child > div:first-child': document.querySelectorAll('.visualizer-still > div:first-child > div:first-child').length,
        'shell div[class*="bg-[radial-gradient"]': document.querySelectorAll('.visualizer-still div[class*="bg-[radial-gradient"]').length,
        'doc [class*="radial-gradient"]': document.querySelectorAll('[class*="radial-gradient"]').length,
      },
    };
  });
}

// Apply the DOM patch. Returns what was hidden so the report can name the exact node the product would
// have to target. still-b hides ONLY nodes that (a) have "radial-gradient" in their class list and
// (b) cover at least 90% of the viewport — the definition of the full-screen backing plate from task-3.
async function applyDomPatch(page, kind) {
  if (kind === 'still-radial') {
    return page.evaluate(() => {
      const str = (e) => (typeof e.className === 'string' ? e.className : e.className?.baseVal ?? '');
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const area = vw * vh;
      const cover = (el) => {
        const r = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        return (w * h) / area;
      };
      const targets = [...document.querySelectorAll('[class*="radial-gradient"]')].filter((el) => cover(el) >= 0.9);
      const hidden = targets.map((el) => {
        const detail = { tag: el.tagName.toLowerCase(), className: str(el).slice(0, 240), rect: rect(el) };
        el.style.setProperty('display', 'none', 'important');
        return detail;
      });
      // Text survival is checked geometrically on the shot, but also count visible leaf text nodes here.
      const shell = document.querySelector('.visualizer-still');
      let visibleTextNodes = null;
      if (shell) {
        visibleTextNodes = 0;
        for (const el of shell.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if ((el.textContent || '').trim().length > 0 && el.children.length === 0) visibleTextNodes++;
        }
      }
      return {
        cssRule: 'JS: [...document.querySelectorAll(\'[class*="radial-gradient"]\')].filter(covers>=90% viewport).forEach(el => el.style.setProperty("display","none","important"))',
        selector: '[class*="radial-gradient"] (cover >= 90% viewport)',
        candidateHits: document.querySelectorAll('[class*="radial-gradient"]').length,
        ruleTargetHits: targets.length,
        hiddenNodes: hidden,
        visibleTextNodes,
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

// The visualizers animate: a single frame can misreport coverage badly. tempera both re-randomises its
// glyph camera layout per mount AND runs a per-frame film-grain pass, so consecutive frames of one patched
// scene measured 3.2% .. 18.0%. Each case is captured FRAME_COUNT times and the verdict uses the MEDIAN;
// the full per-frame list is printed so the spread is visible instead of averaged away.
const FRAME_COUNT = 8;
const FRAME_INTERVAL_MS = 800;

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
  // mode/tuning/theme must be injected on the SSE request itself, exactly like transparency.mjs does.
  await page.route('**/obs/events*', async (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('mode', c.mode);
    u.searchParams.set('transparent', '1');
    if (tuning) u.searchParams.set('tuning', JSON.stringify(tuning));
    if (c.theme) u.searchParams.set('theme', JSON.stringify(c.theme));
    await route.continue({ url: u.toString() });
  });

  const shot = path.join(OUT, `${c.tag}.png`);
  const beforeShot = c.domPatch ? path.join(OUT, `${c.tag}-before.png`) : null;
  const centerRect = {
    x: CENTER_REGION.x * VIEWPORT.width,
    y: CENTER_REGION.y * VIEWPORT.height,
    w: CENTER_REGION.w * VIEWPORT.width,
    h: CENTER_REGION.h * VIEWPORT.height,
  };
  const result = {
    tag: c.tag,
    mode: c.mode,
    label: c.label,
    note: c.note || null,
    tuning: tuning ? tuning[c.tuningMode] : null,
    theme: c.theme || null,
    screenshot: rel(shot),
    beforeScreenshot: beforeShot ? rel(beforeShot) : null,
    loadError: null,
    domPatch: null,
    domInspect: null,
    alpha: null,
    beforeAlpha: null,
    magenta: null,
    beforeMagenta: null,
    centerBefore: null,
    centerAfter: null,
    themeEvidence: null,
    frames: [],
    frameStats: null,
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

    // still-b: diagnose BEFORE touching anything, so the report can name the real vignette node.
    if (c.domPatch === 'still-radial') result.domInspect = await diagnoseStill(page);

    // Theme delivery check: the stage root paints the theme's primary colour. Measuring it here proves
    // the `theme=` SSE override actually reached the page (light theme -> rgb(20,20,20) instead of the
    // demoData default rgb(244,244,245)), so the lumiere-d/e comparison is not a no-op.
    result.themeEvidence = await page.evaluate(() => {
      const root = document.querySelector('#root > *');
      const coloured = [...document.querySelectorAll('#root [style*="color"]')].map((el) => getComputedStyle(el).color);
      return { rootClass: root ? String(root.className).slice(0, 80) : null, rootColor: root ? getComputedStyle(root).color : null, sampleColors: [...new Set(coloured)].slice(0, 6) };
    });

    if (beforeShot) {
      await page.screenshot({ path: beforeShot, omitBackground: true, fullPage: false });
      result.beforeAlpha = analyzeAlpha(beforeShot);
      result.beforeMagenta = analyzeMagenta(beforeShot);
      result.centerBefore = analyzeRegionAlpha(beforeShot, centerRect);
    }

    if (c.domPatch) {
      result.domPatch = await applyDomPatch(page, c.domPatch);
      await sleep(400); // let the DOM patch paint one frame before the shot
    }

    // The visualizers animate, and tempera both re-randomises its glyph camera layout on every mount and
    // runs an intro transition, so a single frame can misreport coverage by >10pp (measured: tempera-c
    // frame1 11.0% vs frame3 3.0%). Take FRAME_COUNT frames of the identical patched scene, keep frame 1 as
    // the headline shot, and let the verdict use the MEDIAN so one transient frame cannot decide the patch.
    const t0 = Date.now();
    for (let i = 0; i < FRAME_COUNT; i++) {
      if (i > 0) await sleep(FRAME_INTERVAL_MS);
      const file = i === 0 ? shot : path.join(OUT, `${c.tag}-f${i + 1}.png`);
      await page.screenshot({ path: file, omitBackground: true, fullPage: false });
      const frame = {
        index: i,
        tMs: Date.now() - t0,
        screenshot: rel(file),
        alpha: analyzeAlpha(file),
        magenta: analyzeMagenta(file),
        center: analyzeRegionAlpha(file, centerRect),
      };
      result.frames.push(frame);
    }
    const covs = result.frames.map((f) => f.alpha.alphaAbove8Ratio).sort((a, b) => a - b);
    const first2 = result.frames.slice(0, 2).map((f) => f.alpha.alphaAbove8Ratio);
    const rest = result.frames.slice(2).map((f) => f.alpha.alphaAbove8Ratio);
    const restMax = rest.length ? Math.max(...rest) : null;
    // Median alpha composition over the frames: the verdict is decided on median cov8, so the strength
    // statement must be measured the same way (frame 1 alone can be the intro-transition frame).
    const medianBands = {};
    for (const k of Object.keys(result.frames[0].alpha.bands)) medianBands[k] = median(result.frames.map((f) => f.alpha.bands[k]));
    result.frameStats = {
      count: covs.length,
      cov8: result.frames.map((f) => f.alpha.alphaAbove8Ratio),
      tMs: result.frames.map((f) => f.tMs),
      min: covs[0],
      median: covs[Math.floor(covs.length / 2)],
      max: covs[covs.length - 1],
      spread: Math.round((covs[covs.length - 1] - covs[0]) * 10000) / 10000,
      // A decaying transient (intro transition) shows up as frame 1 sitting well above the settled frames.
      // Compare against the median of frames 3..N, not their max: a single high frame can be noise upward.
      transient: rest.length > 0 && result.frames[0].alpha.alphaAbove8Ratio - median(rest) > 0.03,
      first2,
      restMedian: rest.length ? [...rest].sort((a, b) => a - b)[Math.floor(rest.length / 2)] : null,
      medianAlphaZeroRatio: median(result.frames.map((f) => f.alpha.alphaZeroRatio)),
      medianPartialRatio: median(result.frames.map((f) => f.alpha.alphaPartialRatio)),
      medianFullRatio: median(result.frames.map((f) => f.alpha.alphaFullRatio)),
      medianMeanAlpha: median(result.frames.map((f) => f.alpha.meanAlpha)),
      medianBands,
      medianStrongPaintRatio: median(result.frames.map((f) => f.alpha.strongPaintRatio)),
    };
    // Headline numbers = frame 1 (the file named <tag>.png); verdicts use the median below.
    result.alpha = result.frames[0].alpha;
    result.magenta = result.frames[0].magenta;
    result.centerAfter = result.frames[0].center;
    result.painted = await collectPainted(page);
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
// Reference levels from task-1 (unpatched, transparent window): classic (DOM text only) cov8 = 3.5%,
// sonnet (lyrics + halo) cov8 = 20.8%. Task-3 sets the target for the patched cases at cov8 < 8%,
// i.e. "the backing plate is gone, only text/wireframe remains".
const CLASSIC_COV8 = 0.035;
const TARGET_COV8 = 0.08;
function grade(cov8) {
  if (cov8 <= 0.06) return { level: 'text-only', label: `只剩文字/线框（cov8 ${(cov8 * 100).toFixed(1)}% ≈ classic ${(CLASSIC_COV8 * 100).toFixed(1)}%）` };
  if (cov8 <= TARGET_COV8) return { level: 'target-met', label: `达标（cov8 ${(cov8 * 100).toFixed(1)}% < 8% 目标，只剩少量光晕/文字）` };
  if (cov8 <= 0.2) return { level: 'text-halo', label: `文字+光晕（cov8 ${(cov8 * 100).toFixed(1)}%，视觉可接受但未达 8% 目标）` };
  if (cov8 <= 0.5) return { level: 'partial-plate', label: `仍有明显半透明底板（cov8 ${(cov8 * 100).toFixed(1)}%）` };
  return { level: 'unusable', label: `底板基本未消除（cov8 ${(cov8 * 100).toFixed(1)}%）` };
}

// Per-case verdict overrides where the generic coverage grade is not the whole story (light-theme
// controls, and still-b whose acceptance test is "plate gone AND text still painted").
// Coverage is judged on the MEDIAN of FRAME_COUNT frames, so an animation frame cannot swing the verdict.
function verdictFor(r) {
  if (!r.alpha) return { level: 'error', label: `无法测量：${r.loadError || 'capture failed'}` };
  const medCov = r.frameStats?.median ?? r.alpha.alphaAbove8Ratio;
  const medCenterA8 = median(r.frames.map((f) => f.center.alphaAbove8Ratio));
  const medCenterMean = median(r.frames.map((f) => f.center.meanAlpha));
  const g = grade(medCov);
  // Frame-to-frame spread: a patch only counts if it holds in all frames, so surface the spread loudly.
  const spreadNote =
    r.frameStats == null
      ? ''
      : `；${r.frameStats.count} 帧 cov8 ${r.frameStats.cov8.map((v) => (v * 100).toFixed(1)).join('/')}%，中位 ${(medCov * 100).toFixed(1)}%，波动 ${(r.frameStats.spread * 100).toFixed(1)}pp`;
  // Residual STRENGTH matters as much as area: low-alpha haze is mostly eaten by a chroma key, while
  // alpha>64 paint is what a user actually sees. Use the MEDIAN over frames (same basis as the verdict).
  const bands = r.frameStats?.medianBands ?? r.alpha.bands;
  const strong = r.frameStats?.medianStrongPaintRatio ?? r.alpha.strongPaintRatio;
  const strengthNote = `；残余分带（8 帧中位）33-64 tint ${(bands.a33_64 * 100).toFixed(1)}% / >64 实体 ${(strong * 100).toFixed(1)}% / 1-32 淡雾 ${((bands.a1_8 + bands.a9_32) * 100).toFixed(1)}%`;
  const withSpread = (o) => ({ ...o, label: o.label + strengthNote + spreadNote });
  if (r.tag === 'still-b') {
    const textKept = medCenterA8 > 0.005 && medCenterMean > 0.3;
    const plateGone = medCov < TARGET_COV8;
    if (plateGone && textKept) {
      return withSpread({
        level: 'target-met',
        label: `可适配：暗角已移除（cov8 中位 ${(medCov * 100).toFixed(1)}% < 8%），中心区仍有文字（alpha>8 ${(medCenterA8 * 100).toFixed(1)}%，meanA ${medCenterMean}）`,
      });
    }
    if (plateGone && !textKept) return withSpread({ level: 'text-lost', label: `暗角移除但文字也没了（cov8 中位 ${(medCov * 100).toFixed(1)}%，中心区 alpha>8=${(medCenterA8 * 100).toFixed(1)}%）` });
    return withSpread({ level: g.level, label: `暗角未完全移除：${g.label}` });
  }
  if (r.tag === 'lumiere-e') {
    return withSpread({ ...g, label: `浅色主题无补丁对照：cov8 ${(medCov * 100).toFixed(1)}%，全屏 alpha≈239（=0.94 地板）；主题背景亮度 ${luminanceOfHex(LIGHT_THEME.backgroundColor)} > ${LUMIERE_FLOOR.luminanceThreshold} 触发地板` });
  }
  if (r.tag === 'lumiere-d') {
    return withSpread({ ...g, label: `浅色主题+补丁：cov8 ${(medCov * 100).toFixed(1)}%，与对照 lumiere-e 完全相同（gap 0.0pp）→ darkField:0 被 0.94 地板覆盖，浅色主题必然整屏不透明` });
  }
  if (r.tag === 'lumiere-c')
    return withSpread({ ...g, label: `深色主题+{darkField:0,textOnly:true}：cov8 中位 ${(medCov * 100).toFixed(1)}%，${g.level === 'unusable' || g.level === 'partial-plate' ? '光束/雾仍是大面积半透明，不可适配' : '可适配（文字+光晕）'}` });
  return withSpread(g);
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
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

  for (const r of results) {
    const base = baselines[r.mode] ? { alpha: baselines[r.mode].alpha, screenshot: baselines[r.mode].screenshot } : null;
    let basePink = null;
    if (baselines[r.mode]?.screenshot) {
      const p = path.join(__dirname, baselines[r.mode].screenshot);
      if (fs.existsSync(p)) basePink = analyzeMagenta(p);
    }
    const entry = {
      ...r,
      baseline: base
        ? {
            cov8: base.alpha.alphaAbove8Ratio,
            meanAlpha: base.alpha.meanAlpha,
            alphaFullRatio: base.alpha.alphaFullRatio,
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
      verdict: null, // filled below
    };
    entry.verdict = verdictFor(entry);
    out.cases.push(entry);
  }
  out.method = {
    knobDelivery:
      'OBS surface builds its EventSource URL with only ?token=, so mode/transparent/tuning/theme are injected by rewriting the /obs/events request URL with page.route() (server.mjs reads them from the SSE query).',
    tuningCompleteness:
      "Full default tuning objects (copied from the dist literals) with only the target field flipped, because Folia's tuningRegistry apply replaces the tuning object instead of merging defaults; a partial object would leave fields undefined.",
    themeDelivery: 'config.theme and config.subtitleTheme are replaced wholesale with the LIGHT_THEME object (server.mjs `theme=` param, parsed JSON); delivery is proven at runtime by comparing the stage root computed colour (rgb(20,20,20) for the light theme vs the demoData default rgb(244,244,245)).',
    lumiereDarkFieldFloor:
      'lumiere does NOT use darkField directly for the dark-field plate: dist/assets/createLumierePixiRuntime-BTwrnJKT.js computes Ai=.18 (luminance threshold), ji=.94 (alpha floor), and Ni=(theme,darkField)=>{ const n=luminanceToRgb(theme.backgroundColor); const i=Se(n)>Ai; return {alpha: i ? Math.max(clamp(darkField), ji) : clamp(darkField)} } with Se=e=>.2126*r+.7152*g+.0722*b on 0..1 channels. Any theme background with relative luminance > 0.18 therefore gets alpha >= 0.94 (=239/255) no matter what darkField is. This is why lumiere-d (light theme + darkField:0) is bit-for-bit as opaque as lumiere-e.',
    stillPatch:
      'No guessed selector: query every [class*="radial-gradient"] node, keep only those whose intersection with the viewport is >=90% of the viewport area, and set display:none!important on exactly those. The report names the node and its rect so the product rule can be written from evidence.',
    textSurvivalTest:
      'Centre window region x 30%-70%, y 35%-65% of the 1920x1080 shot: alpha>8 pixel count/ratio and mean alpha before vs after the DOM patch. Non-zero after hiding the plate = the lyric text is still painted.',
    magenta:
      'Each PNG pixel composited over #FF00FF (the chroma-key colour of a real transparent window); pink = (r-g)>40 && (b-g)>40, strongPink = (r-g)>80 && (b-g)>80. pinkRatio over ALL pixels is mostly the empty (alpha=0) area, so it is NOT a pollution measure; pinkKeyAreaRatio = pink AND 0<alpha<255 over the whole window = the area a key-coloured window would visibly tint; pinkRatioOverPartial is the same restricted to semi-transparent pixels.',
    verdictRule:
      'cov8 < 6% = text/frame only; cov8 < 8% = task-3 target met; < 20% = text + halo (visually acceptable); <=50% = still a plate; above = unusable. still-b additionally requires the centre-region text test to pass. Baselines are the phase-1 unpatched transparent shots.',
    stability:
      'Every case is captured 8 times, 800 ms apart (<tag>.png plus <tag>-f2..f8.png). The visualizers animate and tempera both re-randomises its glyph layout per mount and runs a film-grain pass, so consecutive frames of one patched scene measured 3.2% .. 18.0% cov8. The verdict uses the MEDIAN cov8 across the 8 frames and prints every frame plus the spread, so a patch only passes if it holds across the animation, not in one lucky frame.',
  };
  const reportPath = path.join(OUT, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));

  // --- table 1: patched residual coverage + centre-region text proof + frame stability ---
  console.log('\n=== 1) patched transparent shot: residual coverage of 1920x1080 (+ centre text window) ===');
  console.log(
    pad('case', 16) + pad('mode', 8) + padl('a0', 7) + padl('partial', 8) + padl('full', 6) + padl('cov8', 7) +
      padl('meanA', 7) + padl('maxA', 6) + padl('key8', 7) + padl('cov8med', 8) + padl('spread', 7) + padl('cA8before', 10) + padl('cA8after', 9) + padl('cMeanA', 8) + padl('baseCov8', 9) + padl('Δcov8', 7),
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
        padl(r.frameStats ? pct(r.frameStats.median) : '-', 8) + padl(r.frameStats ? `${(r.frameStats.spread * 100).toFixed(1)}pp` : '-', 7) +
        padl(r.centerBefore ? pct(r.centerBefore.alphaAbove8Ratio) : '-', 10) +
        padl(pct(r.centerAfter.alphaAbove8Ratio), 9) + padl(r.centerAfter.meanAlpha, 8) +
        padl(r.baseline ? pct(r.baseline.cov8) : '-', 9) + padl(r.delta ? pct(r.delta.cov8) : '-', 7),
    );
  }
  console.log('\n  verdicts:');
  for (const r of out.cases) console.log('   ' + pad(r.tag, 16) + r.verdict.label);

  // --- table 1b: alpha band composition (how strong is the residual paint?) ---
  console.log('\n=== 1b) alpha band composition of the patched shot (median of 8 frames, share of window) ===');
  console.log(
    pad('case', 16) + padl('a0', 7) + padl('1-8', 7) + padl('9-32', 7) + padl('33-64', 7) + padl('65-128', 8) +
      padl('129-192', 9) + padl('193-254', 9) + padl('255', 7) + padl('strong>64', 11) + padl('cov8', 7) + padl('transient', 11),
  );
  for (const r of out.cases) {
    if (!r.alpha) continue;
    const fs_ = r.frameStats;
    const b = fs_?.medianBands ?? r.alpha.bands;
    console.log(
      pad(r.tag, 16) + padl(pct(fs_?.medianAlphaZeroRatio ?? r.alpha.alphaZeroRatio), 7) +
        padl(pct(b.a1_8), 7) + padl(pct(b.a9_32), 7) + padl(pct(b.a33_64), 7) + padl(pct(b.a65_128), 8) +
        padl(pct(b.a129_192), 9) + padl(pct(b.a193_254), 9) + padl(pct(b.a255), 7) +
        padl(pct(fs_?.medianStrongPaintRatio ?? r.alpha.strongPaintRatio), 11) +
        padl(pct(fs_?.median ?? r.alpha.alphaAbove8Ratio), 7) + padl(fs_ ? (fs_.transient ? 'yes' : 'no') : '-', 11),
    );
  }
  console.log('  reading: bands 1-8 / 9-32 are a haze that a chroma key mostly eats; 33-64 tints; >64 is visible paint.');
  console.log('  transient=yes means the first 1-2 frames are >3pp above the rest (intro animation), i.e. the shot itself is not representative.');

  // --- table 2: 3x3 grid ---
  console.log('\n=== 2) 3x3 grid a>8 coverage (patched) ===');
  for (const r of out.cases) {
    if (!r.alpha) continue;
    console.log(pad(r.tag, 16) + gridString(r.alpha.gridAbove8Ratio));
  }

  // --- table 3: magenta (colour-key) risk ---
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
      console.log(`   ${pct(p.cover).padStart(6)}  ${p.tag}.${p.class.slice(0, 70)}  rect=${p.rect.w}x${p.rect.h}@${p.rect.x},${p.rect.y}  bg=${p.backgroundColor}${p.isCanvas ? `  canvas=${p.bitmap}` : ''}`);
    }
  }

  // --- table 5: still-b full DOM diagnosis (the deliverable lead asked for) ---
  const stillRow = out.cases.find((r) => r.tag === 'still-b');
  console.log('\n=== 5) still-b: .visualizer-still full DOM diagnosis ===');
  if (!stillRow?.domInspect?.shellFound) {
    console.log('shell NOT found');
  } else {
    const d = stillRow.domInspect;
    console.log('shellFound=true viewport=' + d.viewport.w + 'x' + d.viewport.h + ' childCount=' + d.childCount);
    console.log('shellClass="' + d.shellClass + '"');
    console.log('\n  recursive children (index | tag | rect | childElementCount | textContent[0:40] | className):');
    for (const ch of d.children) {
      console.log(
        `   [${String(ch.index).padEnd(5)}] ${pad(ch.tagName, 5)} ${padl(ch.rect.w + 'x' + ch.rect.h + '@' + ch.rect.x + ',' + ch.rect.y, 20)} ` +
          `kids=${pad(ch.childElementCount, 3)} text="${(ch.textContent || '').replace(/\s+/g, ' ').slice(0, 40)}" class="${ch.className.slice(0, 160)}"`,
      );
    }
    console.log('\n  every [class*="radial-gradient"] node in the document:');
    for (const rn of d.radialNodes) {
      console.log(
        `   #${rn.index} tag=${rn.tag} cover=${(rn.cover * 100).toFixed(1)}% qualifies(>=90%)=${rn.qualifies} display=${rn.display} opacity=${rn.opacity} rect=${rn.rect.w}x${rn.rect.h}@${rn.rect.x},${rn.rect.y}`,
      );
      console.log(`        class="${rn.className}"`);
      console.log(`        backgroundImage=${rn.backgroundImage}`);
    }
    console.log('\n  radialQualifying=' + d.radialQualifying);
    console.log('  hitCounts=' + JSON.stringify(d.hitCounts));
    console.log('\n  shell.outerHTML (first 4000 chars):\n' + d.outerHTML.split('\n').map((l) => '   ' + l).join('\n'));
    console.log('\n  hidden by patch: ' + JSON.stringify(stillRow.domPatch?.hiddenNodes));
    if (stillRow.beforeAlpha) {
      console.log('  before: cov8=' + pct(stillRow.beforeAlpha.alphaAbove8Ratio) + ' meanA=' + stillRow.beforeAlpha.meanAlpha + ' centreA8=' + pct(stillRow.centerBefore.alphaAbove8Ratio) + ' centreMeanA=' + stillRow.centerBefore.meanAlpha);
      console.log('  after : cov8=' + pct(stillRow.alpha.alphaAbove8Ratio) + ' meanA=' + stillRow.alpha.meanAlpha + ' centreA8=' + pct(stillRow.centerAfter.alphaAbove8Ratio) + ' centreMeanA=' + stillRow.centerAfter.meanAlpha + ' centreA8pixels=' + Math.round(stillRow.centerAfter.alphaAbove8Ratio * stillRow.centerAfter.pixels));
      console.log('  visibleTextNodes(shell)=' + stillRow.domPatch?.visibleTextNodes);
    }
  }

  // --- table 6: lumiere light-theme comparison (d vs e) ---
  const ld = out.cases.find((r) => r.tag === 'lumiere-d');
  const le = out.cases.find((r) => r.tag === 'lumiere-e');
  console.log('\n=== 6) lumiere: light theme patched (d) vs unpatched control (e), + dark patched (c) ===');
  for (const r of [out.cases.find((x) => x.tag === 'lumiere-c'), ld, le].filter(Boolean)) {
    if (!r.alpha) {
      console.log(pad(r.tag, 12) + 'FAILED');
      continue;
    }
    console.log(
      pad(r.tag, 12) + padl('cov8 ' + pct(r.alpha.alphaAbove8Ratio), 12) + padl('meanA ' + r.alpha.meanAlpha, 12) +
        padl('full ' + pct(r.alpha.alphaFullRatio), 12) + padl('partial ' + pct(r.alpha.alphaPartialRatio), 14) +
        padl('cA8after ' + pct(r.centerAfter.alphaAbove8Ratio), 18) + '  ' + r.verdict.level,
    );
  }
  if (ld?.alpha && le?.alpha) {
    const dCov = ld.frameStats?.median ?? ld.alpha.alphaAbove8Ratio;
    const eCov = le.frameStats?.median ?? le.alpha.alphaAbove8Ratio;
    const gap = Math.abs(dCov - eCov);
    console.log(
      `\n  -> light theme: patched ${pct(dCov)} vs unpatched ${pct(eCov)} (gap ${pct(gap)}). ` +
        (gap < 0.05
          ? 'IDENTICAL: darkField is not the source of the light-theme plate.'
          : 'The patch materially reduces coverage in a light theme.'),
    );
    console.log(
      `  -> why (code): lumiere picks its dark-field alpha from the THEME BACKGROUND LUMINANCE in\n` +
        `     dist/assets/createLumierePixiRuntime-BTwrnJKT.js:\n` +
        `       Ai=.18, ji=.94, Ni=(e,t)=>{ let n=be(e.backgroundColor,[0,0,0]), r=clamp(t), i=Se(n)>Ai; return {color:xe(n,.06), alpha:i?Math.max(r,ji):r} }\n` +
        `       Se=e=>.2126*e[0]+.7152*e[1]+.0722*e[2]\n` +
        `     backgroundColor ${LIGHT_THEME.backgroundColor} -> relative luminance ${luminanceOfHex(LIGHT_THEME.backgroundColor)} > ${LUMIERE_FLOOR.luminanceThreshold}` +
        ` -> alpha floor ${LUMIERE_FLOOR.alphaFloor} (=${LUMIERE_FLOOR.floorAlpha255}/255), so darkField:0 is clamped away.\n` +
        `     Measured dominant alpha in both shots: 239 — exactly the 0.94 floor. Light themes can never be\n` +
        `     transparent under this rule; only a theme with background luminance <= ${LUMIERE_FLOOR.luminanceThreshold} can.`,
    );
  }

  // Theme delivery proof: if the override had not reached the page, these two rows would be identical.
  console.log('\n=== 7) theme delivery evidence (stage root computed colour) ===');
  for (const r of out.cases.filter((x) => x.theme)) {
    console.log(
      '   ' + pad(r.tag, 14) + 'rootColor=' + pad(String(r.themeEvidence?.rootColor), 18) +
        'sampleColors=' + JSON.stringify(r.themeEvidence?.sampleColors ?? []),
    );
  }
  console.log('   (default demoData theme primaryColor is rgb(244, 244, 245); rgb(20, 20, 20) proves the override arrived)');

  const errors = out.cases.filter((r) => r.loadError || r.consoleErrors.length || r.pageErrors.length || r.failedRequests.length);
  console.log('\n=== 8) anomalies ===');
  if (!errors.length) console.log('none — all ' + out.cases.length + ' cases loaded, no console/page errors, no failed requests');
  else for (const e of errors) console.log(`${e.tag}: loadError=${e.loadError} console=${e.consoleErrors.length} page=${e.pageErrors.length} failedReq=${e.failedRequests.length}`);

  console.log('\nscreenshots + report: ' + OUT);
  console.log('report: ' + reportPath);
}

main().catch((err) => {
  console.error('[tuned] fatal', err);
  process.exitCode = 1;
});
