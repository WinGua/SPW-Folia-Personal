# spw-folia-host — native fullscreen host (protocol v1 implementation)

`spw-folia-host.exe` is the native helper that the `spw-folia` Kotlin plugin spawns when the user
opens Folia mode. It owns a borderless fullscreen window, hosts Folia's production OBS visualizer
bundle in WebView2, forwards the plugin's protocol-v1 JSON lines into the page (via an injected
shim), captures WASAPI loopback audio and pushes it to the page, and reports lifecycle/errors back
to the plugin on stdout. It contains **no music/business logic** — the plugin is the single source
of truth. Contract: `docs/protocol.md`. Spike/decision background: `docs/webview-spike.md`.

Source: `poc/webview/host/` — `Program.cs` (CLI, JSON helpers, stdout writer, main),
`HostForm.cs` (window, WebView2, timer tick, stdin loop, screenshots), `AudioProvider.cs`
(synthetic / stdin / WASAPI-loopback seam), `Shim.js` (injected, EventSource bridge +
`window.__SPW_FOLIA__`), `Overlay.js` (injected placeholder HUD), `build.sh`, `driver.mjs`
(protocol-v1 test driver), `app.manifest`. Audio: `poc/audio/native/*.cs` (MIT, task-4) is copied
to `poc/webview/host/audio/` and compiled in.

---

## 1. Build

No .NET SDK, no MSBuild: the C# 5 in-box compiler is enough (Windows 11 has it).

```bash
cd poc/webview/host
bash build.sh
```

`build.sh` does:

1. `csc.exe` = `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (v4.0.319, C# 5 language
   level; no interpolation/`?.`/expression bodies — async/await is fine).
2. `export MSYS2_ARG_CONV_EXCL='*'` and convert every path with `cygpath -w` (MSYS otherwise
   mangles `/out:` into a POSIX path — `error CS2001`).
3. Regenerate `DefaultConfig.json` from `poc/webview/shared/demoData.mjs` (embedded demo config).
4. Compile: `-target:exe -platform:x64 -optimize+ -define:LOOPBACK`, embed
   `Shim.js`/`Overlay.js`/`DefaultConfig.json` as resources, reference
   `System.dll System.Core.dll System.Windows.Forms.dll System.Drawing.dll
   System.Web.Extensions.dll` (JavaScriptSerializer = the JSON parser) and the WebView2 SDK dlls
   from `poc/webview/tools/sdk/`; sources = `Program.cs HostForm.cs AudioProvider.cs
   DpiSupport.cs audio/{AudioInterop,SpectrumAnalyzer,FoliaAudioMapper,SharedAudioRing,LoopbackAnalyzer}.cs`.
5. Write `build/spw-folia-host.exe.config` (`supportedRuntime v4.8`, PerMonitorV2 DPI awareness,
   `EnableWindowsFormsHighDpiAutoResizing`) and copy `Microsoft.Web.WebView2.Core.dll`,
   `Microsoft.Web.WebView2.WinForms.dll`, `WebView2Loader.dll` next to the exe.

Output: `build/spw-folia-host.exe` **114,176 B** + config 406 B + WebView2 dlls 931,872 B
(Core 698,208 / WinForms 38,752 / Loader 194,912) ≈ **1.04 MB** unpacked. Rebuild time ≈ 1 s.

WebView2 SDK dlls: download `https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2`,
extract `lib/net462/Microsoft.Web.WebView2.{Core,WinForms}.dll` and
`runtimes/win-x64/native/WebView2Loader.dll` into `poc/webview/tools/sdk/`.

---

## 2. CLI reference

```
spw-folia-host.exe [options]
```

| option | default | meaning |
| --- | --- | --- |
| `--bundle <dir>` | – | production bundle dir (contains `index.html`); served at `https://spw-folia.local/`. Required unless `--dev-url`/`--url` is given. |
| `--dev-url <url>` | – | dev server URL (protocol §7), e.g. `http://127.0.0.1:18080/?obs=1&token=dev`; no virtual host mapping. |
| `--url <url>` | derived | explicit load URL override (debug; normally derived from bundle + `?obs=1&token=…`). |
| `--fullscreen` | **on** | borderless fullscreen on primary screen, topmost (protocol default). |
| `--window <w>x<h>` | 1280×720 | windowed mode (`--window 1600x900`, also `1600,900`). |
| `--windowed [w,h]` | – | flag form of windowed mode, optional size. |
| `--width`, `--height` | 1280, 720 | windowed size components. |
| `--no-topmost` | topmost on | clears always-on-top. |
| `--user-data <dir>` / `--user-data-dir <dir>` | `%LOCALAPPDATA%\spw-folia\webview` | WebView2 profile dir. |
| `--fps-log [path]` | no file | append page FPS samples (`atMs,fps,heapMB,canvases,dpr,w,h`) to a file (path optional, also forwarded). |
| `--screenshot <png>` `--shot-at <ms>` | – / 5000 | capture page content once at N ms after start (PNG via `CapturePreviewAsync`). |
| `--duration <ms>` | 0 = run until close | auto-close after N ms (diagnostics). |
| `--devtools` | off | WebView2 devtools enabled. |
| `--title <text>` | `spw-folia-host` | window title. |
| `--no-esc` | ESC closes | disable ESC-to-close (kiosk tests). |
| `--keep-alive` / `--exit-on-stdin-close` | exit on stdin EOF | controls whether stdin EOF closes the helper (`--keep-alive` keeps it alive). |
| `--demo` / `--no-demo` | off | embed the synthetic demo config + auto-patch stdin lyrics/track into Folia shape (standalone runs). |

Track messages carry the album cover as a base64 data URL (`coverDataUrl`). Since v0.1.2 the host
forwards the same value to the page under **both** `coverDataUrl` and `coverUrl` (mirror), because the
Folia settings island's theme derivation reads `coverUrl`. Without the mirror the derived theme silently
stayed at the default palette — see `docs/verification-v0.1.2.md`.
| `--mode <name>` | from config | force `visualizerMode` in the embedded demo config. |
| `--dev-settings <json-or-path>` | – | initial settings tree: inline JSON or a path to a `.json` file; used to feed the injected settings UI at startup. |
| `--assets <dir>` | – | extra static dir mapped to `https://spw-folia-assets.local/`. |
| `--no-overlay` | overlay injected | skip the placeholder HUD script (automated tests). |
| `--settings-dir <dir>` | – | settings-UI dist dir → mapped to `https://spw-folia-settings.local/` and its entry module script injected **after** `Shim.js`. |
| `--settings-entry <file>` | `settings-ui.js` | settings-UI entry filename inside `--settings-dir`. |
| `--force-dsf <n>` | follow Windows | pass `--force-device-scale-factor=n` to WebView2 (CSS px = device px at 1; dev/DPI experiments). |
| `--bundle-version <text>` | – | echoed in the page `hello` message. |
| `--exit-after-fps <n>` | 0 = off | diagnostic: close once a page FPS sample ≥ n. |
| `--audio-log` | off | print `{"t":"audio-stats",…}` every ~2 s (loopback verification). |

**Exit codes:** `0` normal close; `2` bad args / bundle dir missing or without `index.html`;
`3` WebView2 Runtime not found (helper prints a `{"t":"log","level":"error","msg":"webview2-runtime…"}`
line first — the plugin should show "install WebView2 Runtime" instead of a blank window);
`1` other error (window/WebView2 init failure, unhandled exception). Last message on stdout is
always `{"t":"closed","reason":"user"|"error"|"plugin"}` before exit.

---

## 3. Protocol-v1 behaviour (implementation notes per docs/protocol.md)

### stdin → host (`t` field)
`hello` (versions logged; optional `devUrl` navigates the page), `settings` (stored, forwarded to
page as `{"type":"settings"}`; re-sent on page `ready`), `state` (anchor for clock interpolation,
see below), `lyrics` (forwarded as `{"type":"lyrics"}`; `--demo` converts protocol lines to Folia
`LyricData` shape before forwarding), `track` (forwarded as `{"type":"track"}`; `--demo` patches the
demo config), `config` (replaces base config and is forwarded on next page-ready/patch),
`audioMode` (`off`/`stdin`/`loopback` routing), `quit` (closes with reason `plugin`), and
`command` (`close`, `screenshot {path}`, `settings`/`open-settings`/`close-settings` → page `ui`
message, `eval {script}` debug).
Robustness: UTF-8, CRLF tolerated, empty lines skipped, partial lines buffered by `StreamReader`;
unparsable line → `log` line, helper keeps running. stdin EOF → 2 s timer → close reason `plugin`
(so a dead plugin never leaves a zombie window); `--keep-alive` disables that.

### stdout → plugin (`t` field)
`ready` `{protocol:1,pid,webviewVersion,bundle,startedAtMs}` as soon as the page navigation
completes and the shim is installed; `closed` `{reason}`; `settings` `{settings}` (page pushed a
settings change); `action` `{name:"reset"|"openDevTools"|"reload"}`; `log` `{level,msg}` for
diagnostics (also `fps`, `screenshot`, `eval-result`, `audio-stats` diagnostic lines).

### host → page
Timer at 15 ms (~64 Hz) posts `{"type":"state",posMs,durationMs,playing,rate,lyricOffsetMs,tsMs}`
and `{"type":"audio",power,bass,lowMid,mid,vocal,treble,spectrum[…],tsMs}`. The injected shim turns
them into the **real Folia SSE event shapes**: `state` → `clock`
`{currentTime:posMs/1000,duration,playerState:'PLAYING'|'PAUSED',sentAtMs:Date.now(),
playbackRate:rate,lyricOffsetMs:offset/1000}` (throttled to 250 ms or on playing-change; the Folia
page interpolates between samples itself); `audio` → `{audioPower,bands:{bass,lowMid,mid,vocal,
treble},spectrum:Uint8Array(1024),sentAtMs}`. `config`/`lyrics`/`track` are dispatched as
`config`/`lyrics`/`track` SSE events; unknown/debug messages are exposed through
`window.__SPW_FOLIA__.on(...)` and the page→host `action`/`log`/`settings`/`beatDebug` channel is
wired the same way.
Paused/finished playback (or a silent/absent loopback frame) sends the protocol §5 breathing
payload: `power` + all five bands = `(sin(now/2000)+1)*20`, `spectrum` empty — Folia's "breathing"
idle look (verified in the loopback run).
Clock anchoring: while a `state` message is fresh (≤ 500 ms) the host sends
`anchorPosMs + (now - anchorAtTick) * rate`; if the plugin stops sending (stale state) the host
free-runs the timeline so the window never freezes on a plugin hiccup.

### page → host (via `window.chrome.webview.postMessage`)
`ready` (page-mounted → host re-sends `hello`/`settings`), `settings`, `action` (close/reset/
openDevTools → forwarded to stdout and acted on), `log`, `fps` (rAF meter: fps/longFrames/heapMB/
canvases/dpr/w/h), `key` (ESC handled host-side, F1 emits the `ui` toggle-settings action for the
settings UI).

### Cursor & settings-overlay UI state (v0.1.1)

The fullscreen window does **not** hide the cursor permanently. A 15 ms tick in `HostForm.OnTick` tracks
`Cursor.Position`; after 2.5 s without movement the host calls `Cursor.Hide()`, the next movement shows it
again, and while the in-page 歌词样式 overlay is open the cursor is forced visible. Only state changes are
logged (`cursor hide overlay=closed idleMs=…`, `cursor show …`) and the cursor is shown again when the
window closes / the process exits.

Overlay state comes from the page over the normal bridge: the settings UI reports every open/close via
`chrome.webview.postMessage({"type":"ui","settingsOpen":bool})`; the Shim intercepts its own
`settingsUI` special message so it is never re-dispatched locally (a v0.1.0 bug that echoed the state
event and re-toggled the overlay hundreds of times per second). The same `settingsOpen` flag gives ESC its
priority: F1/`command open-settings` opens the panel, ESC #1 closes the panel (window stays), ESC #2 closes
the window (`closed{reason:user}`, exit 0).

### Window/lifecycle
Borderless `Form`, black background; fullscreen uses `Screen.PrimaryScreen.Bounds`, `TopMost`,
`ShowInTaskbar=false`; ESC (host `ProcessCmdKey` or page keydown) and Alt+F4 close
with reason `user`, exit 0. WebView2 configured with autoplay allowed and throttling/occlusion
disabled (`--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling
--disable-renderer-backgrounding --disable-backgrounding-occluded-windows
--disable-features=CalculateNativeWinOcclusion`), context menus/status bar/swipe/zoom off.

---

## 4. How the Kotlin plugin spawns it

```
pluginDir/
  lib/spw-folia.jar
  web/…                     # Folia bundle subset (index.html + assets)
  host/spw-folia-host.exe   # + 3 WebView2 dlls + exe.config
```

```kotlin
class FoliaHostProcess(private val pluginDir: File, private val onMessage: (JsonObject) -> Unit) {
    private var proc: Process? = null
    private var writer: BufferedWriter? = null

    fun start(fullscreen: Boolean = true, bundleVersion: String? = null): Boolean {
        if (proc?.isAlive == true) return true                    // singleton per plugin
        val exe = File(pluginDir, "host/spw-folia-host.exe")
        val web = File(pluginDir, "web")
        require(exe.isFile && File(web, "index.html").isFile)     // fail fast with a user message
        val pb = ProcessBuilder(exe.absolutePath, "--bundle", web.absolutePath,
                if (fullscreen) "--fullscreen" else "--window", "1600x900")
        pb.directory(pluginDir)
        pb.redirectErrorStream(false)                             // stderr = host diagnostics only
        val p = pb.start()
        proc = p
        writer = p.outputStream.bufferedWriter(Charsets.UTF_8)
        Thread {                                         // stdout reader: one JSON object per line
            p.inputStream.bufferedReader(Charsets.UTF_8).forEachLine { line ->
                runCatching { json.parseToJsonElement(line).jsonObject }.onSuccess(onMessage)
            }
            // EOF == helper exited; clear state, allow reopen
        }.apply { isDaemon = true }.start()
        Thread { p.errorStream.bufferedReader().forEachLine { /* log */ } }.apply { isDaemon = true }.start()
        send(mapOf("t" to "hello", "protocol" to 1, "pluginVersion" to VERSION,
                   "spwVersion" to SpwVersion.VERSION, "bundleVersion" to bundleVersion))
        return true
    }

    fun send(obj: Map<String, Any?>) {              // one JSON line, newline-terminated
        writer?.let { it.write(json.encodeToString(obj)); it.newLine(); it.flush() }
    }
    fun stop() { send(mapOf("t" to "quit")); proc?.let { if (!it.waitFor(2, TimeUnit.SECONDS)) it.destroyForcibly() } }
}
```

Sending cadence: `hello` → `settings` → (on `ready`) `lyrics` + `track` + `config`, then `state`
every 100 ms (protocol §6). Stop sending `state` on `closed`; update `config` at ≤ 10 Hz when the
user changes settings. Never send `state` before `ready` (the helper tolerates it, but the page is
not listening yet).

---

## 5. Measured results (this machine: Win11, 3200×2000 @ 180 %, WebView2 150.0.4078.83)

| metric | windowed 1600×900 | fullscreen 3200×2000 |
| --- | --- | --- |
| `ready` (spawn → nav complete + shim) | 523–597 ms (`nav-done` 569–597 ms, WebView2 ready ~452 ms) | 523 ms |
| page FPS median | 118 | 119.2 |
| FPS min (first meter sample, includes first-frame hitch) | 38.8 | 51.8 |
| FPS max | 120 | 120 |
| JS heap max | 44.3 MB | 35 MB |
| canvases | 3 | 3 |
| CSS viewport / dpr seen by page | 888×500 @ dpr 1 (window 1600×900, raster scale 1.8) | 1776×1110 @ dpr 1 |

15-style cycle inside the host window (`--modes …`): all 15 screenshotted, median 114 fps, heap
≤ 59.2 MB. WASAPI loopback run: 1024-bin spectrum delivered each ~16 ms tick (e.g.
`power=30.187 bass=160.253 lowMid=11.19`), `silent=true` path after the tone stopped, capture
latency mean 2.7–3.4 ms / p95 6.9–7.9 ms, CPU 0.97 % of one core (audio-probe `--perf`). Startup
cost is dominated by WebView2 bring-up (~0.5 s), not our code.

Known limitations: beat FX not available (see `docs/webview-spike.md` §6); loopback is
post-volume so lowering the system volume lowers visual reactivity (expected Folia behaviour);
AGC off by default; multi-monitor selection not implemented (primary only); transparency and
click-through are not wired (not needed for fullscreen v1); one WebView2 profile per user data dir;
the page must be 100 % offline (no external network requests — verified).

---

## 6. Standalone demo (what the plugin will do, without the plugin)

```bash
# build
cd poc/webview/host && bash build.sh

# end-to-end protocol v1: spawns the host, sends hello/settings/lyrics/track, streams 100 ms
# state + 60 Hz audio, screenshots at different clock positions, simulates ESC, writes report
cd poc/webview/host && node driver.mjs --window 1600x900
cd poc/webview/host && node driver.mjs --fullscreen --out out/fullscreen

# all 15 styles cycling through the live config channel inside the host window
cd poc/webview/host && node driver.mjs --window 1280x720 --out out/host-styles-run \
  --modes sonnet,tempera,lumiere,diorama,pendolo,monet,fume,cappella,partita,claddagh,cadenza,tilt,still,window,classic

# dev-server variant (protocol §7), documented for plugin dev builds
cd poc/webview/server && node server.mjs 18080 &
./build/spw-folia-host.exe --dev-url "http://127.0.0.1:18080/?obs=1&token=dev" --window 1600x900 --demo
```

Reports/artifacts: `out/driver-report.json` (ready/closed/exit/fps/screenshots/stderr/stdout),
`out/smoke/driver-report.json`, `out/fullscreen/`, `out/host-styles-run/` (15 host screenshots),
`out/loopback-test.jsonl` (`--audio-log` trace). Acceptance run: `ready` + 696 `state` messages
consumed + 3 screenshots at different `posMs` + ESC → `closed{reason:user}` + exit 0 + empty stderr.

Dev-server acceptance (`--dev-url`, note: a standalone run needs `--demo` or a config push, exactly
like the plugin will send one; without it the page correctly shows its "等待 Folia 播放" idle state):

```bash
cd poc/webview/server && node server.mjs 18080 &            # dev-only SSE server (production: none)
cd poc/webview/host && ./build/spw-folia-host.exe \
  --dev-url "http://127.0.0.1:18080/?obs=1&token=dev" --window 800x450 --demo \
  --duration 7000 --screenshot out/devurl-shot2.png --shot-at 5000
```

Result (verified): `nav-done success=True atMs=534`, `page-ready`, `ready{protocol:1,…}`,
screenshot 229,341 B showing the rendered sonnet scene with track title/artist and lyric glyphs,
`closed{reason:plugin}`, exit 0. Artifact: `poc/webview/host/out/devurl-shot2.png`.

---

## 7. Open items / handoffs

- **Settings UI injection**: implemented host-side (`--settings-dir`/`--settings-entry`, virtual host
  `https://spw-folia-settings.local/`, module script after `Shim.js`; `F1`/`command settings` →
  page `ui` action). Waiting on the task-5 bundle (`poc/settings-ui/dist`) and its open/close
  contract; host needs only the entry filename.
- **Config publisher**: production `ObsBrowserSourceConfig` is built **page-side** by the injected
  settings UI (`window.__SPW_FOLIA__.pushConfig(config)`) per protocol §4; the host only forwards
  `config`/`settings` and `--demo` exists solely for standalone runs.
- **Audio calibration**: expose a sensitivity/AGC setting if users report under-reactive visuals on
  quiet output devices (audio-probe owns measured calibration).
- **Multi-monitor**: add `--monitor <index>` or a settings-driven picker; still primary-only.
- **Packaging**: helper + dlls + `web/` go into the `.spmod` (layout in `docs/webview-spike.md` §7);
  keep `LICENSE`/`NOTICE` alongside per `docs/licensing.md`.

---

## 8. v1.1 additions (packaging pass, docs/protocol.md §7.5)

- **`--open-settings`** (first-run): open the settings overlay once, as soon as the injected island
  emits `bridgeReady` (fallback: 2.5 s after navigation). The plugin sends it only when no persisted
  settings exist; later opens show the visualizer directly. Verified in the packaged smoke test.
- **Settings-overlay ownership was moved to the page/island** (protocol §7.5): the settings UI
  registers `__SPW_FOLIA__.ui` (`isSettingsOpen/openSettings/closeSettings/toggleSettings`) and
  consumes ESC itself in the capture phase while open. Shim behavior: on `Escape` it checks
  `__SPW_FOLIA__.ui.isSettingsOpen()`; if open it does nothing (the island closes the overlay), if
  closed it forwards the key so the host closes the window with `closed{reason:"user"}`. Host
  `command open-settings/close-settings` is routed by the Shim into
  `__SPW_FOLIA__.ui.openSettings()/closeSettings()` (verified round-trip: closed→open via commands).
- **`--force-dsf <n>` is debug-only.** Production runs fullscreen at the monitor DSF (page CSS
  viewport = monitor px / DSF; on the reference 3200×2000 @ 180 % machine that is ~1778×1111, which
  lays out both visualizer and full-viewport settings overlay correctly). Use `--force-dsf 1` only
  for small-window smoke tests where Folia's `lg:` breakpoint (≥1240×780 CSS px) matters. Never
  default it on: it overrides the user's Windows scaling.
- **Packaged-layout validation**: the shipped tree is `packaging/` (web + native + licenses +
  checksums + size budget). Rebuild with `bash packaging/build-package.sh`; acceptance test with
  `node packaging/tools/verify-layout.mjs` (settings first-run, ui command round-trip, ESC-once
  closes overlay, ESC-twice closes window, exit 0, 0 console errors, screenshots). Full details and
  the `.spmod` assembly mapping are in `docs/release.md`.
- **Settings-UI cache-buster (task-12)**: the injected settings island is loaded from a stable
  virtual-host URL, so WebView2's HTTP disk cache (user data dir
  `%LOCALAPPDATA%\spw-folia\webview`) can keep serving the *previous* `settings-ui.js` after a
  plugin upgrade. The module URL is now versioned:
  `https://spw-folia-settings.local/<entry>?v=<bundleVersion>` where `bundleVersion` comes from the
  plugin (`--bundle-version <pluginVersion>`, protocol `hello.bundleVersion`, fallback `dev`). Log
  line: `settings-inject url=…`. `Shim.js`/`Overlay.js` are compiled into the exe as script strings
  (not URLs) and therefore cannot go stale. Validate with a fresh `--user-data-dir` and by logging
  `getComputedStyle(gear).pointerEvents` + the in-page style marker.
- **Validation trap — stale payload/cache**: diagnostic harnesses must unpack a **fresh payload per run**
  and use a **fresh `--user-data-dir`**. During task-12 diagnosis a diagnostic (`probe-hit.mjs`)
  reused an old unpacked tree in `%TEMP%\spw-folia-rc-input`, so it evaluated the *pre-fix*
  `settings-ui.js` (gear showed `data-visible=true` but computed `pointer-events:none`) and produced a
  misleading root cause. `run-real-input.mjs` now deletes and re-extracts its work dir on every run,
  passes a per-run `--user-data-dir`, and logs the loaded bundle marker
  (`spw-chrome-btn{pointer-events:auto`), computed `gear pointerEvents` and the injected settings
  script URL (must contain `?v=<bundleVersion>`).
- **Relative-cwd spawn verified** (plugin install layout): from the plugin directory,
  `lib\spw-folia-host.exe --bundle web --settings-dir web\settings --settings-entry settings-ui.js
  --open-settings` → `nav-done` at 560 ms, settings auto-opened, screenshot, clean exit.

---

## 9. Spawn robustness when launched by the plugin (task-9)

### 9.1 Symptom and root cause

When the helper was launched from a **GUI parent process** (the plugin JVM started as `javaw.exe` —
no console attached), the first integration attempt showed the WebView2 page at an **8×6 CSS
viewport**: the window was created hidden/zero-sized by the spawner's `STARTUPINFO` (or the window
never got an explicit geometry while WebView2 was initialising), so WebView2 sized its compositor to
the 8×6 client area and the Folia stage laid out into a postage stamp. The same exe launched from a
console (`java.exe`, or by hand) was fine — so it was a spawn-context bug, not a rendering bug.
The failure was silent: the host logged `ready` and FPS, the page rendered 3 canvases, only the
geometry was wrong.

### 9.2 Fixes (all in `poc/webview/host/`)

- **`DpiSupport.cs` (new)**: DPI-awareness is initialised and *reported*. `SetProcessDpiAwarenessContext(
  PMv2)` first; if it fails with `ERROR_ACCESS_DENIED` (awareness already set by our manifest —
  the normal case) it reports `already-set(<DescribeAwareness>)` instead of falling through to a
  misleading `system`. The log line `dpi-init result=… awareness=…` makes the state auditable.
- **`HostForm.CreateParams`**: `WS_VISIBLE` is forced at handle creation, so the window exists
  visible even when the parent passes `SW_HIDE`.
- **`ApplyWindowGeometry(reason)`** is now idempotent and called at **handle-created, OnLoad,
  after `Navigate`, after first frame, and 3.5 s later**; it re-asserts bounds
  (`Screen.PrimaryScreen.Bounds` for fullscreen, `ClientSize` for `--window`), `TopMost`,
  `ShowInTaskbar=false`, and `ShowWindow(SW_SHOW/SW_RESTORE)+SetForegroundWindow` when the parent
  spawned us hidden. Every call logs `geometry reason=… mode=… bounds=… client=… screen=…
  workarea=… dpi=… winDpi=… awareness=…`.
- **`DpiSupport.PageViewport`**: the `fps`/page-viewport log now includes
  `{w,h,dpr,canvases,client}` so a geometry regression is visible in any run: the page CSS viewport
  must be `client px / DSF` (e.g. 3200×2000 physical → 1776×1110 CSS @180 %), never tiny.
- `--no-esc` is honoured for every close path; diagnostics go to stderr+stdout `log` lines only
  (never to the protocol stream as non-JSON).

### 9.3 Measured (reference machine, 3200×2000 @ 180 %, WebView2 150.0.4078.83)

| run | `dpi-init` | geometry | page viewport | result |
| --- | --- | --- | --- | --- |
| standalone windowed 800×450 | `already-set(per-monitor)` | `window=1200,775 800x450` | 444×250 @dpr 1, 3 canvases | OK (`geometry` at handle-created logged client 794×403 then 800×450) |
| standalone fullscreen | `already-set(per-monitor)` | `0,0 3200x2000` | 1776×1110 @dpr 1, 3 canvases | screenshot 3,327,788 B, exit 0 |
| **parent `java.exe`** fullscreen (packaged layout) | `already-set(per-monitor)` | `0,0 3200x2000` | 1776×1110 @dpr 1, 3 canvases | `ready` 1,534 ms after spawn, screenshot 3,588,594 B, `closed{plugin}` exit 0 |
| **parent `javaw.exe`** fullscreen (the failing scenario) | `already-set(per-monitor)` | `0,0 3200x2000` | 1776×1110 @dpr 1, 3 canvases | `nav-done` 503 ms, screenshot 3,568,662 B, 638 frames, `lastFps 120`, exit 0 |

`winDpi=173` (180 % scaling) while .NET Framework's `Form.DeviceDpi` still reports 96 — the host
therefore uses `GetDpiForWindow` (logged) for any scaling decision, never `DeviceDpi`. The page CSS
viewport is physical size / DSF (3200×2000 → 1776×1110), as expected; `--force-dsf` remains
debug-only (§8).

### 9.4 Repro harness

`poc/webview/host/repro/JavaSpawner.java` reproduces the plugin's spawn shape exactly: it launches
the packaged exe with `--bundle <packaging/web> --fullscreen --settings-dir … --settings-entry
settings-ui.js --screenshot <png> --shot-at 6000`, then sends `hello`/`settings`/`config` + 100 ms
`state` frames over stdin and reads stdout; run it with both `java.exe` and `javaw.exe`:

```bash
cd poc/webview/host/repro && javac -encoding UTF-8 JavaSpawner.java
cd .. && REPRO_SETTINGS="$PWD/repro/default-settings.json" \
  "C:/Program Files/Java/jdk-25.0.2/bin/javaw.exe" -cp repro JavaSpawner \
  "D:/输出目录/dsh2/packaging/native/spw-folia-host.exe" "D:/输出目录/dsh2/packaging/web" \
  "D:/输出目录/dsh2/packaging/out/repro-javaw-fullscreen.log" --duration-ms 9000 \
  --shot "D:\\输出目录\\dsh2\\packaging\\out\\repro-javaw-fullscreen.png" --settings
```

Evidence: `packaging/out/repro-java-fullscreen.{log,png}`,
`packaging/out/repro-javaw-fullscreen.{log,png}` (full-screen 3201×2001 capture with the settings
gear chrome from task-5), `poc/webview/host/out/task9-fullscreen-standalone.png`. After the fix the
packaged acceptance test still passes 10/10 (`docs/release.md` §6).

## 10. 早期 stdin 健壮性（2026-10-19）

插件按协议 §6 在 spawn 后**立刻**发 `hello`/`settings`，此时 WebView2 控制器可能尚未创建。旧实现 `PostToPage` 直接访问 `webView.CoreWebView2`，会记一条 `error: post-page: NullReferenceException`（不影响后续渲染，但污染日志，且暴露早发数据被丢弃）。现在：

- `PostToPage` 在 `webviewReady == false` 或 `CoreWebView2 == null` 时记 `debug post-page-skip reason=not-ready bytes=N` 后返回，不再抛 NRE；
- `settings`/`config` 原本就在 `NavigationCompleted` 重发；`lyrics`/`track` 现在缓存最后一份 payload，并在导航完成时回放（此前早发的 lyrics/track 会丢失，设置页输入区/歌词预览可能为空）；
- 回归：`node tmp-verify/early-stdin-test.mjs`（250 ms 早发 hello+settings+lyrics+track+config）→ 0 NRE、3 次正确 skip、`ready` at 514 ms、页面 3 canvases 且 settings root 已挂载、正常 `closed{reason:"plugin"}`；`poc/hook/probe-live-preview.mjs` 默认/`--self-test` 两种模式复验 11/11 PASS（`docs/verification-live-preview.md` §7）。当前 exe sha256 `d0961bb65acc4fb1e4883c71594fbd004054c37bed9dd5a584a7fad81e717542`。
