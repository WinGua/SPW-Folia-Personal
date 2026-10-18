# WebView spike — hosting Folia's real visualizer in a native window

**Status: DECIDED & IMPLEMENTED.** Folia 0.7.21 ships a production, Electron-free
"OBS browser source" surface (`index.html?obs=1&token=…`). We host that **unmodified production
bundle** in a small native helper (C# WinForms + WebView2) and feed it through a JSON-lines bridge
implemented by an injected shim. All 15 shipped visualizer styles render, fullscreen at 119–120 fps,
offline, no Folia rebuild, no HTTP server in production.

Task-3 (this doc) = decision-grade spike. Task-6 host implementation details live in
`docs/host-app.md`; protocol contract is frozen in `docs/protocol.md`; licensing analysis in
`docs/licensing.md`.

---

## 1. Decision (TL;DR)

| candidate | verdict |
| --- | --- |
| **A. Native helper exe (`spw-folia-host.exe`, C# .NET Framework 4.8 + WebView2), spawned by the JVM plugin, stdio JSON-lines** | **CHOSEN.** Working end-to-end, ~1 MB helper + 7.9 MB web subset, 119–120 fps, offline, fullscreen, no runtime download (WebView2 Runtime is part of Windows 10/11 evergreen), AGPL-compatible, crash isolation, no native code inside the JVM. |
| B. JCEF / jcefmaven inside the JVM (Swing OSR) | **Fallback only.** Not needed and not built. Would add a ~150–250 MB CEF bundle to the `.spmod`, native extraction/loading inside the JVM, weaker OSR compositing and DPI/fullscreen ergonomics, and a second heavy toolchain. Kept as contingency if a Windows image without WebView2 must be supported. |
| C. Port visualizers to Kotlin/Compose | Rejected for v1: ~60k lines of Vue/TS/GLSL, AGPL, and every Folia release would need re-porting. Pixel fidelity impossible to match in budget. |
| D. Embed WebView2 via COM/JNI into the JVM process | Rejected: WebView2 needs an STA UI thread + hwnd ownership; doing that through JNA is fragile with no upside over spawning a helper (the helper is 1 MB and the IPC is 100 JSON lines/s). |

**Plugin-process variant (chosen shape):** the JVM plugin builds an event timeline and spawns the
helper as a child process, exactly like the installed `spw-island` plugin spawns native helpers.
The helper owns the window + WebView2 + (later) WASAPI loopback; the plugin owns all Workshop data.
Communicate over redirected stdin/stdout, one JSON object per line, UTF-8 (see `docs/protocol.md` §1/§2).

Why a helper exe does not hurt the architecture:

- one extra Windows process (~150–250 MB RSS combined with the WebView2 renderer, same class as any
  Chromium host) — acceptable for a fullscreen visual mode that runs during playback only;
- fullscreen borderless window, topmost toggle, ESC close, DPI, focus and multi-monitor are plain
  WinForms problems, solved once;
- WASAPI loopback capture lives in the same process as the UI, so audio never crosses a process
  boundary at 60 Hz (only 5 bands + 1024-bin spectrum are pushed into the page);
- a helper crash cannot take down the player; the plugin sees stdout EOF + exit code and can reopen.

---

## 2. Render bring-up — it is Folia's own output

### 2.1 How the OBS surface works (schema extraction)

- `src/utils/appSurface.ts`: surface = `obs` when `?obs=1` **or** path is `/obs`.
  Query params honored: `obs` and `token`. Nothing else selects a surface.
- The page mounts `ObsBrowserSourceApp.tsx`, which renders the real `VisualizerRenderer` (all styles)
  and opens `EventSource('/obs/events?token=' + token)`. The server (Folia's Electron main process in
  production; `poc/webview/server/server.mjs` in our spike) sends three event kinds; the page does
  `JSON.parse((event as MessageEvent).data)` — **the SSE `data` field must be a JSON string**.
- **What `token` protects:** the `/obs/events` SSE endpoint. It gates a plain `GET` so that other
  software/pages running on the machine cannot subscribe to the user's playback state, audio and
  lyrics. It is not a cryptographic auth scheme — it is a per-window random secret embedded in the
  URL the host loads (and it is visible to any local process that can enumerate windows/URLs).
  In production the host loads `https://spw-folia.local/index.html?obs=1&token=<random>`.

Event schemas (verified against `src/types/obsBrowserSource.ts` + `electron/main.cjs`; full shapes
are reproduced in `poc/webview/server/server.mjs` and `poc/webview/shared/demoData.mjs`):

- `config` : `ObsBrowserSourceConfig` = `{ activePlaybackContext, stageSource, hasTrack,
  song:{id,name}, songArtist, songAlbum, coverUrl, lyrics: LyricData{lines:Line[]}, theme,
  subtitleTheme, isDaylight, visualizerMode, visualizerTunings, background, lyricsFontScale,
  visualizerOpacity, subtitleOverlayOpacity, staticMode, hideTranslationSubtitle,
  showSubtitleTranslation, subtitleContentMode, seed, updatedAt }`.
  `Line = {words: Word[], startTime(s), endTime(s), fullText, translation?, …}`,
  `Word = {text, startTime, endTime, syllables?}` (times in **seconds**).
- `clock` : `{ currentTime(s), duration(s), playerState:'PLAYING'|'PAUSED'|'IDLE', sentAtMs,
  playbackRate, lyricOffsetMs }`. The page interpolates `sentAtMs + (now - sentAtMs) * playbackRate`,
  so a host that pushes clock at ~10 Hz already looks smooth.
- `audio`  : `{ audioPower, bands:{bass,lowMid,mid,vocal,treble}, spectrum:number[] (≤256 bins in
  OBS mode, OBS_SPECTRUM_BIN_LIMIT=256), sentAtMs }`. `audioPower`/bands drive camera/word motion,
  `spectrum` drives per-style overlays (e.g. monet's bars).

Practical consequence: **the entire render pipeline is reusable as-is**. No Vue harness, no
Folia source build, no shim around `VisualizerRenderer` is needed — the OBS surface already IS the
headless contract we would have had to build.

### 2.2 Bring-up proof (browser)

`poc/webview/dist/dist` is the web bundle extracted from the installed app:
`npx @electron/asar extract "C:\Program Files\Folia\resources\app.asar" poc/webview/dist`.

A 90-line Node server (`poc/webview/server/server.mjs`) serves that directory and implements
`/obs/events` with a synthetic 4-line, 16 s lyric timeline + synthetic 60 Hz audio.
`poc/webview/server/check.mjs` loads it in headless Edge (Playwright `channel:'msedge'`) at
1920×1080 and screenshots it.

- `poc/webview/server/out/browser-sonnet-1920x1080.png` — real Folia sonnet output: giant
  white MG glyphs, cyan/red chromatic split, film grain, theme label bottom-left, translation
  subtitle bottom-centre. Verified visually.
- `poc/webview/server/out/browser-report.json`: 0 console errors, 0 network failures, 3 canvases
  (WebGL 1280×720 backing at 1920×1080 CSS), heap 52.5 MB, rAF ~120 fps uncapped headless.

**All 15 styles** swept by `poc/webview/server/styles.mjs` (one fresh page per mode; screenshot +
PNG luminance analysis so "no visible output" cannot hide):

| mode | render | fps avg (headless) | heap MB | pixel std | console errors | external req |
| --- | --- | --- | --- | --- | --- | --- |
| sonnet | OK | 100.2 | 52 | 58.2 | 0 | 0 |
| tempera | OK | 110.2 | 40.6 | 37.9 | 0 | 0 |
| lumiere | OK | 113.3 | 60 | 40.7 | 0 | 0 |
| diorama | OK | 111.5 | 33.5 | 41.8 | 0 | 0 |
| pendolo | OK | 110.8 | 42.2 | 41.4 | 0 | 0 |
| monet | OK | 112.6 | 41.9 | 58.8 | 0 | 0 |
| fume | OK | 112.7 | 41.4 | 40.0 | 0 | 0 |
| cappella | OK | 113.3 | 66 | 41.2 | 0 | 0 |
| partita | OK | 113.6 | 45.7 | 38.6 | 0 | 0 |
| claddagh | OK | 112.2 | 44.5 | 36.2 | 0 | 0 |
| cadenza | OK | 112.5 | 49.7 | 59.2 | 0 | 0 |
| tilt | OK | 112.7 | 39.3 | 39.4 | 0 | 0 |
| still | OK | 112.1 | 44.9 | 38.8 | 0 | 0 |
| window | OK | 113.0 | 56.8 | 45.2 | 0 | 0 |
| classic | OK | 114.1 | 57.3 | 40.3 | 0 | 0 |

Report: `poc/webview/server/out/styles/report.json`; screenshots
`poc/webview/server/out/styles/<mode>.png` (15/15 present, all non-flat). Average 111.7 fps at
1920×1080 on this machine (headless Edge is uncapped; 120 Hz display).

---

## 3. Host window proof (WebView2, native process)

Implementation: `poc/webview/host/` (C# 5, in-box `csc.exe`, .NET Framework 4.8, WinForms +
Microsoft.Web.WebView2). No dotnet SDK required. Build: `cd poc/webview/host && bash build.sh`.

- borderless window; `--fullscreen` (default) = primary screen bounds, topmost, no taskbar, cursor
  hidden; `--window 1600x900` for development;
- bundle loaded through `SetVirtualHostNameToFolderMapping("spw-folia.local", bundleDir, Allow)` →
  `https://spw-folia.local/index.html?obs=1&token=spike` (no HTTP server, no file:// quirks);
- injected via `AddScriptToExecuteOnDocumentCreatedAsync`, in order: `Shim.js` (replaces
  `window.EventSource` with a bridge-backed fake SSE that delivers **JSON strings**, maps host JSON
  messages to the exact event shapes above, exposes `window.__SPW_FOLIA__`), then the placeholder
  HUD `Overlay.js`, then (when `--settings-dir` is set) the settings-UI module bundle mapped to
  `https://spw-folia-settings.local/`;
- page→host messages: `ready`, `settings`, `action`, `log`, `fps`, `key`; host→page: `state`,
  `lyrics`, `track`, `audio`, `config`, `settings`, `ui`;
- ESC (host `ProcessCmdKey` or page keydown) → `{"t":"closed","reason":"user"}` on stdout, exit 0;
- standalone demo needs no plugin: `--demo` embeds a default config (from
  `poc/webview/shared/demoData.mjs`), and `poc/webview/host/driver.mjs` streams synthetic
  protocol-v1 `state` at 100 ms + audio, exactly like the Kotlin plugin will.

### Measured (this machine: 3200×2000 primary, Windows 11 180 % scaling, WebView2 Runtime 150.0.4078.83)

| scenario | startup | FPS (median / min / max) | heap max | canvases |
| --- | --- | --- | --- | --- |
| windowed 1600×900, full protocol v1 driver, 60 styles-agnostic state | `ready` 597 ms, `nav-done` 569 ms, WebView2 ready ~452 ms | 118 / 38.8 (first meter sample) / 120 | 44.3 MB | 3 |
| borderless fullscreen 3200×2000 physical (1776×1110 CSS @ dpr 1) | `ready` 523 ms | 119.2 / 51.8 (first sample) / 120 | 35 MB | 3 |
| 15-style cycle in the host (windowed 1280×720) | same | 114 / 44.9 / 120 | 59.2 MB | 2–3 |

Screenshots (real window content, captured by host `CapturePreviewAsync`):
- `poc/webview/host/out/fullscreen/driver-pos-1.png` (3201×2001 px) — fullscreen sonnet with lyric
  text "か な 夜 に" and translation "在寂静的夜里";
- `poc/webview/host/out/fullscreen/driver-pos-2.png` — later line, proving stdin `state` advances
  the page clock (different lyrics + glyphs);
- `poc/webview/host/out/driver-pos-1.png` (windowed 1600×900), `.../driver-pos-2.png`;
- 15 style screenshots from the host window: `poc/webview/host/out/host-styles-run/host-styles/
  <mode>.png` (sonnet, tempera, lumiere, diorama, pendolo, monet, fume, cappella, partita,
  claddagh, cadenza, tilt, still, window, classic) — report
  `poc/webview/host/out/host-styles-run/driver-report.json`;
- monet screenshot also proves `track`/`lyrics` stdin lines reach the page
  ("Spike Track" title + word-by-word lyric list).

Protocol acceptance run (task-6 acceptance): stdout `{"t":"ready","protocol":1,"pid":…,
"webviewVersion":"150.0.4078.83","bundle":…}`, 696 `state` lines consumed, 3 screenshots at
different `posMs`, ESC → `{"t":"closed","reason":"user"}`, exit 0, stderr empty.

### Audio (in-process WASAPI loopback, from task-4)

`poc/audio/native/LoopbackAnalyzer.cs` (+ SpectrumAnalyzer/FoliaAudioMapper/SharedAudioRing/
AudioInterop) is compiled into the helper with `-define:LOOPBACK`. Verified with a 440/880 Hz tone
wav while the host rendered and logged `audio-stats`: real 1024-bin spectrum arrived
(`power=7.6→30.2`, `bass=1.3→160.3`, `spectrumLen=1024`), then `silent=true` with the protocol §5
breathing payload after the tone stopped. Measured by audio-probe: capture latency mean 2.7–3.4 ms,
p95 6.9–7.9 ms; CPU 0.97 % of one core (`--perf`, no JSON). Loopback is post-volume; AGC off by
default. If loopback is unavailable the host keeps rendering and sends the §5 breath payload
(warn log), so visuals never freeze.

---

## 4. Self-containment / offline check (Lead question b)

`poc/webview/server/probe-offline.mjs` (report `poc/webview/server/out/offline-report.json`,
screenshots `out/offline-baseline.png`, `out/offline-blocked.png`):

- **99 requests = 98 bundle files + `/obs/events` SSE. All same-origin. `externalRequests=[]`,
  0 failed requests, 0 local 404s.** With every non-`127.0.0.1` request aborted in a fresh context
  the visualizer still renders: 3 active canvases, rAF 119.6–120 fps, 0 page errors, 0 console
  errors, lyric text visible, screenshot luminance matches the online baseline.
- `index.html` has an **importmap pointing @google/genai, react, framer-motion, lucide,
  react-i18next, i18next, i18next-browser-languagedetector at `https://aistudiocdn.com`, but no
  built chunk imports bare specifiers — it is inert** in the production bundle. No CDN fonts
  (only system font stacks); no `.onnx`/`.wasm` model fetches; no workers required by the OBS surface.
- **Minimum file subset actually used by `/obs` (all 15 styles, headless): 98 files /
  8,300,066 B = 7.92 MB** (index.html + icon.svg + runtime-config.js + registerSW.js + 94 assets =
  90 JS chunks + 4 CSS). Excluded: 1,785 files / 12.3 MB, notably `assets/folium-icons/`
  (1,649 tiny files, 0.64 MB) and the 3.9 MB ICU dictionary chunk. Shipping the full 19.64 MB dist
  also works; the 7.92 MB subset is the recommended payload (safe: it is exactly the set the page
  requests; keep the rest only if a future feature needs it).
- Service worker caveat: the probe blocked SW registration (cold-install semantics; otherwise
  Workbox precaches ~all 20 MB). Ship **without** `sw.js`/`workbox-*` and remove the
  `registerSW.js` script tag from `index.html`, otherwise every load 404s on `sw.js` after render.
  Keep `manifest.webmanifest` or strip its `<link>` (it is never fetched in the OBS surface).

---

## 5. Fullscreen / DPI / GPU notes (Lead question c)

- Windows scaling here is 180 % (screen 3200×2000, AppliedDPI 173). WinForms fullscreen at
  `Screen.PrimaryScreen.Bounds` produces a 3200×2000 physical borderless window (verified screenshot).
- Inside WebView2 the page sees **CSS 1776×1110 at `devicePixelRatio=1`** (WebView2 rasterization
  scale ≈ 1.8). The OBS surface itself mocks `innerWidth/innerHeight/devicePixelRatio` to a
  1920×1080 base and zooms, so output is composition-independent; 4K remains crisp because the
  canvas backing is 2880×1620 and the compositor scales it, but text/UI is sharper when the CSS
  viewport matches physical pixels. Two levers: `--force-dsf 1` (passes
  `--force-device-scale-factor=1`, CSS px = device px, more GPU load) and/or
  `--force-device-scale-factor=<n>` for a fixed scale. Default (follow Windows scale) is what the
  screenshots above used and it looks correct; expose `--force-dsf` for exotic DPI setups.
- No special `--use-angle`/GPU flags were needed: WebGL2 + hardware compositing work out of the box
  (3 WebGL canvases; 119–120 fps at 3200×2000 with the 180 % raster scale). The only Chromium flags
  passed are for background throttling/autoplay:
  `--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling
  --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
  --disable-features=CalculateNativeWinOcclusion`.

---

## 6. Beat FX feasibility (Lead question a) — drivable but not shippable in v1

Evidence chain:

- The OBS surface sends only `config`/`clock`/`audio`; there is **no beat event**. Smart-beat in
  Folia's desktop app is produced in the Electron **main** process from two WebGPU model weights,
  `beat_this-wgsl.bin` (41,102,271 B) and `htdemucs-wgsl.bin` (91,838,176 B), located only in
  `C:\Program Files\Folia\resources\models\`; they are **not** in the web dist and are reached over
  Electron IPC/WebGPU. A hosted page has no path to them without shipping the models and patching
  renderer code.
- The current Folia build (0.7.x) has no `stores/motionSignals.ts` source module and no
  `beatImpact/downbeatImpact` exports in the source tree we have; the runtime beat engine lives
  minified inside `assets/playerOverlayLayout-bienYxD-.js` (223,542 B, lazy player overlay chunk).
- That chunk **is importable from the page** (same-URL `import()` returns the same cached module the
  app uses). Its ESM export map was dumped (74 exports) and the beat-driver exports identified:
  `H` = envelope update `(mediaElementLike, t)` (internally `Se.set(beatImpact*scale)`,
  `Ce.set(downbeatImpact*scale)` with 160 ms/200 ms half-life decay), `R` = set beat events
  `(trackKey, events, source, note, trackScale)`, `E` = set current track key, `A` = read
  `{key, time}`, plus debug getters.
- Probe `poc/webview/server/probe-beat-chain.mjs` (report `out/beat-chain.json`) exercised the chain
  from injected code: `A()` before = `{key:null}`, `E('spw-probe')` → `A()` = `{key:'spw-probe'}`,
  `R('spw-probe', events, 'probe', 'injected', 1.4)` accepted, `H(fakeMediaElement, t)` callable —
  i.e. **injected JS can drive the real beat envelope end to end**. But the underlying state is
  module-private, the API is unsupported/minified/version-pinned, and an injected script would have
  to supply its own beat detection.

**Decision: v1 ships without smart-beat / beat FX.** The supported inputs are `audioPower` + 5 bands
+ spectrum, which already make all styles responsive. Optional future experiment (documented, not
committed): run a small beat detector plugin-side (or in the helper's loopback analysis) and inject
`E/R/H` via a version-pinned chunk import guarded by feature detection — acceptable only as an
opt-in "experimental beat FX" toggle, never a release requirement.

---

## 7. Packaging in the Salt Player Workshop plugin (.spmod)

`.spmod` is a zip; at install it is unpacked into the plugin's own directory. Proposed layout
(host works from the unpacked dir, no admin, no installers):

```
spw-folia.spmod (zip)
├─ plugin.json / manifest (SPW workshop metadata)
├─ lib/spw-folia.jar                     Kotlin plugin (plugin UI hook, playback timeline, spawns host)
├─ web/                                  Folia production OBS bundle (7.9 MB subset)
│  ├─ index.html  (registerSW.js tag removed, importmap kept-but-inert)
│  ├─ assets/…    (90 JS + 4 CSS actually requested by /obs; add others only if needed)
│  └─ icon.svg runtime-config.js manifest.webmanifest
├─ host/
│  ├─ spw-folia-host.exe                 ~105 KB (C# 5, .NET Framework 4.8)
│  ├─ spw-folia-host.exe.config          DPI awareness (PerMonitorV2)
│  ├─ Microsoft.Web.WebView2.Core.dll    698,208 B
│  ├─ Microsoft.Web.WebView2.WinForms.dll 38,752 B
│  └─ WebView2Loader.dll                 194,912 B (win-x64)
├─ licenses/ (AGPL-3.0 text, NOTICE, WebView2 license — see docs/licensing.md)
└─ settings-ui/ (when task-5 bundle lands; injected from host --settings-dir)
```

Sizes: web subset **7.92 MB** (full dist 19.64 MB), helper **≈ 1.01 MB** unpacked (105 KB exe +
0.91 MB WebView2 SDK dlls), total ≈ **9 MB** + settings UI bundle. No .NET install: .NET Framework
4.8 is in-box on Windows 10/11; WebView2 Runtime is evergreen (present here as 150.0.4078.83) and
the host detects it up-front: if missing it prints a protocol `log` error and exits with code **3**
so the plugin can show a localized message instead of a blank window.

Runtime data: user-data dir defaults to `%LOCALAPPDATA%\spw-folia\webview` (WebView2 profile),
nothing is written into the plugin dir.

**Plugin spawn recipe** (Kotlin side; matches `spw-island`'s native-helper pattern):

```kotlin
val exe = File(pluginDir, "host/spw-folia-host.exe")
val pb = ProcessBuilder(exe.absolutePath,
        "--bundle", File(pluginDir, "web").absolutePath,
        "--fullscreen")
    .redirectErrorStream(false)
pb.environment()["WEBVIEW2_USER_DATA_FOLDER"] = null // let host default to %LOCALAPPDATA%
val proc = pb.start()
// writer: proc.outputStream (hello/settings/lyrics/track/state@10Hz/config)
// reader: proc.inputStream bufferedReader lines -> JSON: ready/closed/settings/action/log
```

Guard against double spawn with a singleton in the plugin; on `closed` stop the state sender and
wait for the process (2 s) before allowing reopen. Dev recipe (`docs/protocol.md` §7):
`spw-folia-host.exe --dev-url http://127.0.0.1:18080/?obs=1&token=dev`.

---

## 8. JCEF comparison (fallback, not built)

| criterion | WebView2 helper (chosen) | JCEF in-JVM (fallback) |
| --- | --- | --- |
| runtime source | WebView2 Runtime, preinstalled/evergreen on Win10/11 | bundled CEF, `jcefmaven` extracts native bundle on first run |
| payload in `.spmod` | ~1 MB (helper dlls) | ~150–250 MB native bundle (+ JCEF jar) |
| rendering | native Chromium compositing, WebGL2 GPU, 119–120 fps at 3200×2000 | OSR texture upload into Swing, typically lower fps/higher latency, more CPU |
| packaging | exe + 3 dlls, no admin | native libs must be present/loaded in the plugin JVM, antivirus/AV friction on extraction |
| audio | WASAPI loopback in the same helper process at 60 Hz | same possible in-JVM, but mixing native audio code into JVM raises crash blast radius |
| crash blast radius | isolated helper process | a CEF/JNI crash kills the player |
| fullscreen/DPI | plain WinForms: borderless, topmost, per-monitor-v2 | Swing fullscreen + OSR DPI scaling = known pain |
| transparency / click-through | WinForms layered window possible; not needed for fullscreen v1 | JCEF OSR transparency is possible but adds complexity |
| licensing | WebView2 SDK redistributable (check terms), our code AGPL | CEF/JCEF BSD-3, compatible |
| dev loop | csc.exe in-box, no SDK; edit/rebuild ~1 s | JDK + jcefmaven + first-run download, slower |

We did not need JCEF: WebView2 already delivered every requirement with a 1 MB footprint and a
~0.5 s window bring-up. Keep `me.friwi:jcefmaven` as contingency only if WebView2 cannot be assumed
(enterprise images that strip the runtime — and even then the helper can ship a WebView2
bootstrapper instead of switching to CEF).

---

## 9. Known risks / limitations

1. **AGPL-3.0 is viral for our distribution.** We redistribute Folia's compiled visualizer bundle
   (and optionally reuse its React components), so the whole plugin — Kotlin, C# helper, web assets,
   settings UI — must be released **AGPL-3.0-or-later with corresponding source**; see
   `docs/licensing.md`. `.spmod` must contain `LICENSE`/`NOTICE`; repo must carry the Folia upstream
   URL/version/commit and the exact `web/` build recipe. Not legal advice.
2. **Beat FX unavailable in v1** (§6) — smart-beat needs Folia's Electron-side WebGPU models; the
   UI toggle must be disabled or labelled unsupported.
3. **WebView2 dependency** — present on all supported Windows 10/11 images we know of, but the host
   must keep its exit-code-3 path and the plugin a friendly error message.
4. **Audio calibration** — Folia's browser path calibrates `getByteFrequencyData` min/maxDecibels
   assuming `analyser.fftSize` defaults; our WASAPI-derived spectrum is mapped 0..255 + gamma per
   `docs/protocol.md` §5, so absolute motion amplitude may need a user-facing sensitivity setting
   (audio-probe owns calibration). Paused/ended uses the §5 breathing payload (verified).
5. **DPI/multi-monitor** — fullscreen is primary monitor only in v1; multi-monitor needs
   `--monitor` plumbing (TODO). 180 % scaling looks right but is not pixel-perfect for text; expose
   `--force-dsf` if needed.
6. **Style coverage** — tied to the bundled dist version. Folia updates may change `ObsBrowserSourceApp`,
   the SSE schemas or hashed chunk names; pin the Folia version in the build recipe and re-run
   `poc/webview/server/styles.mjs` + `probe-beat*` after each bump.
7. **OBS surface vs app surface parity** — the OBS surface renders all 15 styles but not the
   settings/window chrome, beat FX, or every lyric-list panel; that is intended (we host the
   fullscreen visual mode only).

---

## 10. Reproduce / artifacts

```bash
# 1) extract Folia web bundle from the installed app (read-only input)
npx @electron/asar extract "C:\Program Files\Folia\resources\app.asar" poc/webview/dist

# 2) browser proof + 15-style sweep (headless Edge via playwright-core)
cd poc/webview/server && npm i && node check.mjs && node styles.mjs

# 3) offline / subset proof
cd poc/webview/server && node probe-offline.mjs      # -> out/offline-report.json

# 4) build the native helper (in-box csc.exe, no dotnet SDK)
cd poc/webview/host && bash build.sh                 # -> build/spw-folia-host.exe + dlls

# 5) end-to-end protocol v1 demo (spawns host, streams 100 ms state, screenshots, ESC)
cd poc/webview/host && node driver.mjs --window 1600x900
cd poc/webview/host && node driver.mjs --fullscreen --out out/fullscreen
#    all 15 styles inside the host window:
cd poc/webview/host && node driver.mjs --window 1280x720 --out out/host-styles-run \
    --modes sonnet,tempera,lumiere,diorama,pendolo,monet,fume,cappella,partita,claddagh,cadenza,tilt,still,window,classic

# 6) beat-driver probes
cd poc/webview/server && node probe-beat.mjs && node probe-beat-chain.mjs
```

Key files: `poc/webview/shared/demoData.mjs` (synthetic lyrics/theme/config/audio),
`poc/webview/server/{server,check,styles,probe-offline,probe-beat,probe-beat-chain}.mjs`,
`poc/webview/host/{Program,HostForm,AudioProvider}.cs`, `poc/webview/host/{Shim.js,Overlay.js,build.sh,driver.mjs}`,
`poc/webview/tools/sdk/*.dll` (WebView2 SDK extracted from nuget).

Open items routed elsewhere: settings UI bundle + real config publisher (task-5 / folia-spec),
audio calibration + real loopback device matrix (task-4 / audio-probe), plugin-side spawn + singleton
lifecycle (task-6 + plugin integration), licensing paperwork (docs/licensing.md).
