# spw-folia — packaging & release pipeline

Status: **complete** (task-8). `packaging/` holds the exact payload of the final `.spmod`; the
assembly script, checksums, size budget and a scripted packaged-layout acceptance test are included.
Last verified: 2026-10-20 (v0.2.1 release artifact; host `spw-folia-host.exe` 130,560 B, WebView2 150.0.4078.83).

## 1. What ships

```
packaging/
  web/                         # -> .spmod/web/            (the page the host loads offline)
    index.html                 #    Folia OBS browser-source entry (PWA tags removed)
    assets/…                   #    complete Folia web chunk graph incl. every lazy per-style chunk
    settings/settings-ui.js    # -> injected settings island (task-5 build)
    settings/styles/           #    inlined CSS is in the JS; these are extra assets
    settings/thumbs/*.jpg      #    14 real Folia style thumbnails
    _host/shim.js, overlay.js  #    audit copies of the scripts embedded in the exe
  native/                      # -> .spmod/native/ (plugin resolveHelper also accepts lib/)
    spw-folia-host.exe         #    C# .NET Framework 4.8 helper (130,560 B as of v0.2.0)
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
| `web/` (complete Folia dist + settings island + 2 host-script copies) | 1,898 | 22.35 MB |
| `native/` (exe 130,560 B + config + 3 dlls) | 5 | 1.01 MB |
| `licenses/` | 7 | 0.05 MB |
| **total** | **1,910** | **23.41 MB** (budget 25 MB: OK) |

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
python packaging/tools/assemble-release.py --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.2.1.spmod --staging packaging --out dist/release --name spw-folia-0.2.1.spmod  # 3. merge into dist/release
node packaging/tools/verify-layout.mjs       # 4. packaged-layout acceptance on a clean unpack
```

`packaging/tools/assemble-release.py` copies the Gradle-built `classes/` verbatim, maps `packaging/native/` → `native/`,
`packaging/web/` → `web/`, `packaging/licenses/` → `licenses/`, adds top-level `LICENSE`/`README.md`,
and fails if required files are missing or dev paths leak in. The plugin's `resolveHelper()` accepts the
helper under `native/` and `lib/` (plus dev-only fallbacks), so either layout spawns from the installed payload.

Per-version artifact records (byte sizes, payload hashes, changed-entry lists) are no longer kept
inline; see the release-artifact ledger at the end of this document, and `docs/archive/` for the
historical release notes and verification reports.


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

## Appendix: release-artifact ledger

Only the current release needs its payload hashes checked. The ledger below is the compact record of
what each published `.spmod` was, kept so a downloaded artifact can still be verified against the
repository; per-version change essays and full payload breakdowns live in
[`docs/archive/`](archive/) (and in the GitHub Releases bodies, which ship `SHA256SUMS.txt` next to
every `.spmod`).

| Version | `.spmod` bytes | entries | sha256 | released |
| --- | --- | --- | --- | --- |
| v0.1.0 | 12,443,495 | 1,937 | `8c265dc1aca7ee5ee378b65f5b045ccba7e51536e812e399b0d9cf6bd9d46838` | 2026-10-18 |
| v0.1.1 | 12,450,886 | 1,938 | `9c4d206911eebc43869af2c0aae074efa8f672e081586946e022d7b4c89dac21` | 2026-10-19 |
| v0.1.2 | 12,450,848 | 1,938 | `2dc2f46b8635bd4918f45b65e9cd36d814c876e8c9f5a7827da4d0621174a0b9` | 2026-10-19 |
| v0.1.3 | 12,405,289 | 1,937 | `16bdda573be6f9fed29780881e94feb1f5c0a6d542260c024e4f284c8a5d41ea` | 2026-10-19 |
| v0.1.4 | 12,405,269 | 1,937 | `24ddaf34982a6acb9b92943ead1123d6dfb34ed4c9ae082c94ed2e7d1d82c04e` | 2026-10-19 |
| v0.1.5 | 12,574,908 | 1,937 | `8e88488ba9d4137602c550a1633c98b2b45d2a4ebf578822f7412940d9655c11` | local only |
| v0.1.6 | 13,136,350 | 1,941 | `aacd02afb078b13d09a26930f6981740930df5dfe04343b7a9584cfd84bdcad9` | 2026-10-19 |
| v0.1.7 | 12,970,892 | 1,941 | `5cf8eba69c9d1bb961efd160075c29b9cde52e5b30699598e5ec174106dd5138` | 2026-10-19 |
| v0.1.8 | 12,976,142 | 1,941 | `0913914b37ba5a1b4b8db7775ebb1b7ab1621d1a069a000c43766c4c62b9ad1f` | local only |
| v0.1.9 | 12,975,396 | 1,941 | `8ec1ffb3e4dee3c4befbc953f7d36a22ab1864e5e204439c7c16a5233257ce01` | 2026-10-19 |
| v0.1.10 | 13,145,163 | 1,941 | `4a90d09e95ea37449882f6b7507fcfa3d0ccdf72d86dbc969b26d6426cbcf951` | 2026-10-19 |
| v0.2.0 | 13,149,053 | 1,941 | `d3bc76163dc1fa5598455b48e5fc4674b5a6f588cca5e84fa9951a72160c2fbb` | 2026-10-20 |
| **v0.2.1** | **13,152,604** | **1,941** | `56c0aa4177a1bea8fe0078a9c27ab2dee264f0c85387af0a667086cd39f0e792` | 2026-10-20 |

`local only` builds were verified on a real install but never uploaded; their changes shipped inside
the next published release. v0.1.11 was never built as a standalone artifact either — its two fixes
(see [`archive/verification-v0.1.11.md`](archive/verification-v0.1.11.md)) went out with v0.2.0.

Current release payload (v0.2.1): plugin classes 94,303 B (`68facfed…`), native host 130,560 B
(`2aa1f6c2…`, unchanged since v0.2.0), settings island 1,071,968 B (`eeb8a128…`, unchanged since
v0.2.0), complete Folia 0.7.21 OBS bundle + licenses. Staged payload: 1,910 files / 23.41 MB
(web 1,898 / 22.35 MB, native 5 / 1.01 MB, licenses 7 / 0.05 MB) against a 25 MB budget.
Verify a downloaded artifact with:

```bash
sha256sum spw-folia-0.2.1.spmod    # compare with the ledger row and the release's SHA256SUMS.txt
node packaging/tools/verify-layout.mjs   # packaged-layout acceptance on a clean unpack
```
