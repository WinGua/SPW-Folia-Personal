# spw-folia — packaging & release pipeline

Status: **complete** (task-8). `packaging/` holds the exact payload of the final `.spmod`; the
assembly script, checksums, size budget and a scripted packaged-layout acceptance test are included.
Last verified: 2026-10-18 (host `spw-folia-host.exe` 108,032 B, WebView2 150.0.4078.83).

## 1. What ships

```
packaging/
  web/                         # -> .spmod/web/            (the page the host loads offline)
    index.html                 #    Folia OBS browser-source entry (PWA tags removed)
    assets/… (1,872 files)     #    complete Folia web chunk graph incl. every lazy per-style chunk
    settings/settings-ui.js    # -> injected settings island (task-5 build)
    settings/styles/           #    inlined CSS is in the JS; these are extra assets
    settings/thumbs/*.jpg      #    14 real Folia style thumbnails
    _host/shim.js, overlay.js  #    audit copies of the scripts embedded in the exe
  native/                      # -> .spmod/native/ (plugin resolveHelper also accepts lib/)
    spw-folia-host.exe         #    C# .NET Framework 4.8 helper (~110 KB, 114,176 B here)
    spw-folia-host.exe.config  #    PerMonitorV2 DPI + supportedRuntime v4.8
    Microsoft.Web.WebView2.Core.dll
    Microsoft.Web.WebView2.WinForms.dll
    WebView2Loader.dll
  licenses/                    # -> .spmod/licenses/
    AGPL-3.0.txt               #    full AGPL text (Folia + our code)
    NOTICE.md / SOURCE-OFFER.md / THIRD-PARTY.md
    AUDIO-MIT.txt              #    WASAPI analyzer (MIT)
    WebView2-SDK-LICENSE.txt / WebView2-SDK-NOTICE.txt
  tools/                       # build + verification tooling (never shipped)
    stage-web.mjs              # complete-dist staging (all chunks; SW/PWA excluded, guarded)
    size-report.mjs            # size budget + top files
    verify-layout.mjs          # packaged end-to-end acceptance test
  testdata/default-settings.json  # settings tree fixture for the smoke test
  web-stage-report.json        # what was staged/excluded (audit)
  size-report.json             # size budget result
  SHA256SUMS.txt               # sha256 of every shipped file
  out/                         # verification evidence (screenshots, reports, fps log)
```

Current sizes (`packaging/size-report.json`, `bash packaging/build-package.sh` output):

| area | files | size |
| --- | --- | --- |
| `web/` (complete Folia dist + settings island + 2 host-script copies) | 1,895 | 21.92 MB |
| `native/` (exe 114,176 B + config + 3 dlls) | 5 | 1.00 MB |
| `licenses/` | 7 | 0.05 MB |
| **total** | **1,907** | **22.96 MB** (budget 25 MB: OK) |

The shipped web tree is the **complete** Folia production dist (every lazy chunk included), because
Folia dynamic-imports per-style renderers on demand (`assets/VisualizerTempera-*.js`, …). An earlier
subset built from the cold-start offline closure caused a black window on non-default styles
(`Failed to fetch dynamically imported module`), caught by task-13. `packaging/tools/stage-web.mjs`
now copies the whole `poc/webview/dist/dist` tree and hard-fails if no per-style lazy chunk is present.
Excluded only: the PWA/service-worker trio (`registerSW.js`, `sw.js`, `workbox-*`, `manifest.webmanifest`;
the registration tag is removed from `index.html`) and local `.bak` backups.

## 2. Rebuild the package

Prerequisites (all already produced by the other tasks; rebuild only when an input changed):

```bash
cd D:/输出目录/dsh2
bash poc/webview/host/build.sh          # -> poc/webview/host/build/  (host exe + dlls)
cd poc/settings-ui && pnpm build && cd ../..   # -> poc/settings-ui/dist/ (settings-ui.js + thumbs)
```

Then assemble:

```bash
bash packaging/build-package.sh
```

The script (idempotent, ~20 s) does: stage-web → stage native → stage licenses (copies AGPL from
`work/folia/folia-major-main/LICENSE`, extracts WebView2 `LICENSE.txt`/`NOTICE.txt` from the NuGet
package) → `size-report.json` → `SHA256SUMS.txt`. It fails loudly if an input is missing.

Staging rule of record: `packaging/tools/stage-web.mjs` reads
`poc/webview/server/out/offline-report.json` (`loadedFiles`) and copies only that closure; it also
patches `index.html` (removes the PWA service-worker `<script>` and `manifest` link) and copies the
settings island + embedded-script audit copies. If the Folia dist changes, re-run the offline probe
(`node poc/webview/server/probe-offline.mjs`) to regenerate the dependency report, then re-stage.

## 3. Assembling the final `.spmod`

The Zig/`spw-folia` plugin project (task-1/task-7, owner hook-poc) produces the SPW metadata and
the JVM side. This packaging tree supplies only the payload. Mapping:

| packaging | `.spmod` (unpacked plugin dir) |
| --- | --- |
| `packaging/native/*` | `lib/` (next to the plugin jar/metadata; `WebView2Loader.dll` must stay beside the exe) |
| `packaging/web/*` | `web/` |
| `packaging/licenses/*` | `licenses/` |

So the installed plugin directory looks like:

```
%APPDATA%\Salt Player for Windows\workshop\plugins\spw-folia\
  enabled.txt
  permissions.json
  <plugin metadata + jar>        # from spw-folia/ project (not staged here)
  lib\spw-folia-host.exe
  lib\spw-folia-host.exe.config
  lib\Microsoft.Web.WebView2.Core.dll
  lib\Microsoft.Web.WebView2.WinForms.dll
  lib\WebView2Loader.dll
  web\index.html
  web\assets\…
  web\settings\settings-ui.js
  licenses\…
```

Do **not** ship `packaging/tools/`, `packaging/out/`, `packaging/testdata/` or any reports inside the
`.spmod`; they are build/audit artifacts only.

Scripted assembly (Lead-owned, `docs/protocol.md` order-independent):

```bash
cd spw-folia && ./gradlew.bat plugin        # 1. plugin classes/ (+ lib/ if any runtime deps)
cd .. && bash packaging/build-package.sh     # 2. re-stage web/native/licenses + checksums
python packaging/tools/assemble-release.py --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.1.spmod --staging packaging --out dist --name spw-folia-0.1.1.spmod  # 3. merge into dist/
node poc/webview/host/out/release-candidate/run-rc.mjs   # 4. re-validate from a clean unpack
```

`packaging/tools/assemble-release.py` copies the Gradle-built `classes/` verbatim, maps `packaging/native/` → `native/`,
`packaging/web/` → `web/`, `packaging/licenses/` → `licenses/`, adds top-level `LICENSE`/`README.md`,
and fails if required files are missing or dev paths leak in. The plugin's `resolveHelper()` accepts the
helper under `native/` and `lib/` (plus dev-only fallbacks), so either layout spawns from the installed payload.

### v0.1.0 release artifact (final)

```
dist/release/spw-folia-0.1.0.spmod   12,443,495 B   1,937 entries
sha256 8c265dc1aca7ee5ee378b65f5b045ccba7e51536e812e399b0d9cf6bd9d46838
classes payload sha256 81137cc97612679bf0e2093292d6faf5040c05c523e1d9cd19a41cee37e791b9
native host sha256 aee45d4a88c7395cce72b05eb7bb14f4e07188c4a20afe8b2d460f5f4c3337b4 (cache-buster build)
```

### v0.1.1 release artifact (final)

```
dist/release/spw-folia-0.1.1.spmod   12,450,886 B   1,938 entries
sha256 9c4d206911eebc43869af2c0aae074efa8f672e081586946e022d7b4c89dac21
classes payload sha256 838dc12b4b7a79cc5855f97c5c79f042fe94f6bf229d59f844dc60effe8c6c7a (menu-item styling)
native host sha256 d75b97cbc692ab5e05b5b0cf2d2177002526849181a8787252a11cba896f71ad
                    (cursor auto-hide + settings-overlay UI-state fix, cache-buster build)
```

v0.1.1 changes: host-style 更多 menu item (`FoliaMenuItemContent`, 19 dp sparkle + 14 sp label +
host colour), cursor auto-hide/show (including override while the settings overlay is open), and the
page↔host UI-state echo-loop fix that could blank/flap the settings overlay. Regression evidence:
`poc/hook/shots/cursor-gear-click-0.png`, `docs/acceptance-report.md` addendum.


## 4. Plugin → host spawn contract

The JVM plugin starts the helper as a child process (working directory = the plugin directory, so
**relative paths are used and verified**):

```text
lib\spw-folia-host.exe --bundle web --settings-dir web\settings --settings-entry settings-ui.js [--open-settings]
```

- `--bundle web` — local Folia subset, mapped to `https://spw-folia.local/` inside WebView2. No HTTP
  server, no port, no network.
- `--settings-dir web\settings --settings-entry settings-ui.js` — injected after the Shim from
  `https://spw-folia-settings.local/settings-ui.js`.
- `--open-settings` — first run only: open the settings overlay once the island reports
  `bridgeReady` (fallback 2.5 s after navigation). Persisted-settings detection lives in the plugin.
- `--fullscreen` is the default; add `--window WxH` only for debugging. `--force-dsf 1` is
  **debug-only** (see §7).
- stdin/stdout: UTF-8 JSON lines, protocol v1 (`docs/protocol.md`). Plugin sends `hello`, `settings`,
  then `state` every ~100 ms plus `lyrics` / `track` / `config` on change. Host emits `ready`,
  `log`, `closed` and `fps` lines.
- Singleton: one host process per open Folia mode; if the window already exists, forward the action
  to it instead of spawning a second one. On plugin disable send `quit`, wait for exit, kill after 2 s.
- A stray `spw-folia-host.exe` holding the exe open makes the next build fail (`CS0016`): kill the
  process before rebuilding (`Stop-Process -Name spw-folia-host`).

Measured on this machine (windowed 1600×900, packaged payload): ready at **636–815 ms** after spawn
(WebView2 runtime version 150.0.4078.83), page interactive immediately, 120 fps median once started.

## 5. Interaction contract (protocol §7.5)

- The settings island owns the overlay: it registers `window.__SPW_FOLIA__.ui`
  (`isSettingsOpen/openSettings/closeSettings`) and consumes ESC itself while open (capture phase +
  `stopPropagation`).
- Host commands are forwarded by the Shim into the island: `{"t":"command","command":"open-settings"}`
  and `"close-settings"` call `__SPW_FOLIA__.ui.openSettings()/closeSettings()`.
- ESC with the overlay **closed** reaches the host (`{type:"key",key:"Escape"}`) → host closes the
  window, emits `{"t":"closed","reason":"user"}` and exits 0.
- `--open-settings` opens the overlay through the same path once (`bridgeReady`, timer fallback).

Verified end-to-end in `packaging/tools/verify-layout.mjs` (see §6, `packaging/out/verify-report.json`):
`settingsAutoOpened`, `closeSettingsCommand`, `openSettingsCommand`, `escClosedSettingsOnly`,
`closedUser`, `exitedZero` all true.

## 6. Packaged-layout acceptance test

```bash
node packaging/tools/verify-layout.mjs          # ~16 s, exits 0 on pass
```

What it does: spawns `packaging/native/spw-folia-host.exe` with `--bundle packaging/web`
(+ `--settings-dir web/settings`, `--open-settings`, windowed 1600×900, isolated user-data dir),
streams `hello/settings/lyrics/track` + 100 ms `state` lines, then:

1. probes the page at 4.2 s: bridge + `__SPW_FOLIA__.ui` present, 3 canvases, settings island
   injected from the virtual host, overlay open;
2. screenshot `packaging/out/packaged-firstrun-settings.png` (歌词样式 overlay over live sonnet);
3. sends `close-settings` → probe closed; sends `open-settings` → probe open (host↔page routing);
4. dispatches ESC → settings island closes the overlay only; window still alive (probe);
5. screenshot `packaging/out/packaged-visualizer.png` (visualizer, lyrics + translation);
6. dispatches ESC again → host emits `{"t":"closed","reason":"user"}`, exits 0.

Latest result: **PASS** — all 10 checks true, 0 console errors, 3 canvases, 116 fps median
(min 91 / max 120), heap ≤ 93.8 MB, `ready.startedAtMs 503` (spawn→ready), screenshots
755 KB / 968 KB. Re-verified after the task-9 spawn-hardening rebuild (see `docs/host-app.md` §9).

Relative-path spawn test (plugin install layout), run from `packaging/` itself:

```bash
cd packaging && ./native/spw-folia-host.exe --bundle web --settings-dir web/settings \
  --settings-entry settings-ui.js --window 800x450 --duration 6500 --open-settings --demo \
  --screenshot out/relcwd-shot.png --shot-at 5000
# -> nav-done at 560 ms, open-settings requested auto=true, screenshot 228 KB, exit 0
```

## 7. DPI / DSF caveat

- The production host runs fullscreen at the monitor's device scale factor (DSF). On the reference
  machine (3200×2000 @ 180 % scaling) the page CSS viewport is ~1778×1111 and both the visualizer and
  the full-viewport settings overlay lay out correctly (verified; the overlay is responsive).
- `--force-dsf 1` forces `--force-device-scale-factor=1`, which gives a 1600×1000 window a 1600×1000
  CSS viewport. Use it **only** for small-window smoke tests where Folia's `lg:` breakpoint matters
  (the settings window is designed for ≥1240×780 CSS px). Do not default it on: it bypasses the
  user's Windows scaling and would render small on high-DPI screens.

## 8. Offline / no-network guarantee

The packaged page performs no network requests: verified with a blocked-network browser run —
99 requests, all same-origin/local, 0 external, 0 failed; the aistudiocdn `importmap` in the Folia
`index.html` is inert for the OBS surface; no fonts are fetched from the network (no font files are
shipped either); the service worker is removed. The only external dependency is the machine's
WebView2 Runtime (system component).

## 9. Licensing (AGPL-3.0) — required reading for release

- Folia's web build is **AGPL-3.0**; our plugin reuses its code/components. Therefore the plugin and
  everything we distribute (including `web/`, the settings island and this packaging) are released
  **AGPL-3.0-or-later**. `licenses/AGPL-3.0.txt`, `NOTICE.md`, `SOURCE-OFFER.md` and
  `THIRD-PARTY.md` are shipped inside the plugin directory and must be kept there.
- `web/` is the **unmodified** upstream Folia production build except two removed PWA tags in
  `index.html` (documented in `NOTICE.md`; reproducible via `packaging/tools/stage-web.mjs`).
- The WASAPI analyzer is MIT (copyright ours); the WebView2 SDK DLLs are redistributed under the
  Microsoft WebView2 SDK license (texts shipped). No fonts, no model weights, no Folia binary
  assets are redistributed beyond the web build.
- Before publishing: confirm the exact upstream Folia source URL/tag to cite in `NOTICE.md`
  (currently "folia-major 0.7.21 as distributed in the Folia desktop application"; the release owner
  should add the upstream repository link + commit hash).

## 10. Release checklist (owner: Lead)

1. Build inputs fresh: host build, settings UI build, Folia dist + offline dependency report.
2. `bash packaging/build-package.sh` → staging clean, `size-report.json` within budget,
   `SHA256SUMS.txt` regenerated.
3. `node packaging/tools/verify-layout.mjs` → PASS (keep `packaging/out/verify-report.json` +
   screenshots as release evidence).
4. Copy the three payload areas into the assembled `.spmod` per §3; keep `licenses/` inside.
5. Smoke-test the assembled `.spmod` in a real SPW install (menu item → fullscreen visualizer,
   first-run settings, ESC, track change, pause/seek).
6. Record versions in the release notes: plugin version, host exe sha256, Folia version
   (`folia-major 0.7.21`), WebView2 SDK/NuGet version and tested WebView2 Runtime version
   (150.0.4078.83), settings island build.
7. No secrets in the artifact (`packaging/` contains no credentials).


### v0.1.2 release artifact (final)

```
dist/release/spw-folia-0.1.2.spmod   12,450,848 B   1,938 entries
sha256  2dc2f46b8635bd4918f45b65e9cd36d814c876e8c9f5a7827da4d0621174a0b9
payload plugin classes/            : gradle plugin-dev.spw.folia-0.1.2.spmod
                                  8c6df3c4337a656f2f64cea3fcef03b587609389d75fcdf19a8e821798844155
        native/spw-folia-host.exe  : fdac12775a62621bcf379df950a4f64149fe53bd2124281ce475c3ceef364a0a (115,712 B)
        web/                       : complete Folia 0.7.21 OBS bundle + settings island
                                     (settings-ui.js 1,192.9 kB, no SmartBeat card)
        licenses/                  : AGPL-3.0 + NOTICE + SOURCE-OFFER + THIRD-PARTY + AUDIO-MIT
```

Assembly commands (from repo root):

```bat
cd spw-folia && gradlew.bat plugin && cd ..
bash packaging/build-package.sh
python packaging/tools/assemble-release.py ^
    --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.2.spmod ^
    --staging packaging --out dist/release --name spw-folia-0.1.2.spmod
```

v0.1.2 changes: cover-colour field fix (host mirrors `coverDataUrl`→`coverUrl`, page falls back),
智能动感模式 card removed from the settings bundle, plus docs
`verification-v0.1.2.md` / `known-inert-settings.md`. See `docs/release-notes-v0.1.2.md`.
