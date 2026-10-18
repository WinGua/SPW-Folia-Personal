# spw-folia plugin ↔ native helper integration (task-7)

Status: **DONE** (2026-10-18 22:56, task-7). Menu item → real fullscreen Folia (WebView2) window fed by
the playhead/lyrics/track of Salt Player for Windows 1.19.0, ESC closes, no orphan helper.

Owner: hook-poc. Write scope: `spw-folia/**`, `docs/hook-poc.md`, this file.
Host helper + web bundle are owned by task-6/task-9 (webview-spike): `packaging/native/*`,
`poc/webview/dist/dist`, `poc/settings-ui/dist`.

## 1. What was verified end-to-end (inside real SPW 1.19.0, MS channel)

| # | Check | Evidence |
|---|-------|----------|
| 1 | 5th item **Folia** in the mini-player/播放条 更多 flyout after 释放音频引擎 | `poc/hook/shots/task7-menu-5items.png` (crop of `t7d-menu-1-0.png`), log line `Folia item appended (scope=..., bridge=...)` |
| 2 | Click → plugin spawns `host/spw-folia-host.exe` in the **SPW process tree** | log `Folia item clicked`, `spawn cmdline: …`, `host spawned pid=…`; host stdout `host-start pid=… parentPid=<SPW pid> fullscreen=True window=0,0 3200x2000 …` |
| 3 | Fullscreen window is 3200×2000 (NOT the old 8×6 "bridge screen"); page viewport 1776×1110 @dpr1, 3 canvases | host stdout `geometry reason=handle-created mode=fullscreen bounds=0,0 3200x2000 …`, `page-viewport w=1776 h=1110 dpr=1 canvases=2-3 client=3200x2000` |
| 4 | Playhead advances and lyrics advance/render | plugin log `replay snapshot: pos=… playing=true`, `state #1 … posMs …`; screenshots `task7-fullscreen-lyrics-1/2.png` (new host) and `task7-lyrics-lines-A/B.png` (two different lyric lines ~2.6 s apart) |
| 5 | Settings overlay opens (F1 / host action) and ESC semantics §7.5 | `task7-settings-overlay.png`; ESC #1 → overlay closes, **helper stays alive**; ESC #2 → `host closed reason=user`, helper exits 0 (`task7-esc1-overlay-closed.png`, `task7-esc2-window-closed.png`) |
| 6 | No orphan helper after app shutdown | `poc/hook/orphan-test.ps1`: helper spawned from plugin, SPW killed → `no orphan helper after SPW exit`; relaunch OK |
| 7 | Clean reinstall loop with re-staged native host | installed `host/spw-folia-host.exe` sha256 == `packaging/native/spw-folia-host.exe` (`de8bd433…2704c879`, 114,176 B) |

Raw logs: `poc/hook/logs/plugin-task7.log`, `poc/hook/logs/host-stdout-latest.log`.
Automation: `poc/hook/drive.ps1`, `poc/hook/cycle-test.ps1` (menu→click→spawn→ESC, `-StayOpen`),
`poc/hook/orphan-test.ps1` (spawn→kill SPW→orphan check→relaunch).

## 2. Components (all in `spw-folia/src/main/kotlin/dev/spw/folia/`)

- `FoliaPlugin.kt` — `SpwPlugin`: version guard (`spwVersion == "1.19.0"`), CLASS_TRANSFORM check, the
  proven menu hook (`hookMethod` on `androidx.compose.ui.ē.Ϳ(Track,PiscesMediaItem,Ⴈ,Navigator,State,ন)`),
  item click handler (dismiss popup → `bridge.open()` → Swing fallback only if spawn fails),
  `start()`/`stop()`/`delete()` lifecycle, extension watcher (20 s), file logger `<pluginPath>/spw-folia.log`.
- `FoliaHostBridge.kt` — child-process manager: resolution order + spawn + stdin writer thread + stdout
  reader thread + 100 ms state pump + hello/settings handshake + shutdown (`{"t":"quit"}`, 2 s grace,
  destroyForcibly) + stdout/stderr mirrors into the plugin dir.
- `FoliaPlaybackExtension.kt` — `@Extension class … : PlaybackExtensionPoint`; every callback is logged
  (first call + 10 s summary) and delegated to `TimelineController` from `PlaybackTimeline.kt`; provides
  `snapshot()`, `lyricsJson()`, `trackJson()` (cover as base64 data URL, cached 1.5 s).
- `PlaybackTimeline.kt` — audio-probe's pure-stdlib timeline (copied verbatim from
  `poc/audio/kotlin/dev/spw/folia/PlaybackTimeline.kt`); interpolates the 1 Hz host position into a
  monotonic clock (`TimelineController.positionMs()`), handles seek/rate/pause/resume.
- `FoliaSettingsStore.kt` — opaque persistence of the canonical settings tree (7,230 B
  `default-settings.json`) as one ConfigManager string key `settingsJson`; debounced 200 ms flush,
  deep-equality no-op guard (avoids the settings echo loop that once produced ~1,394 emissions).
- `Json.kt` — minimal escaping + string-aware field extraction (`rawField` keeps the tree byte-identical).

## 3. Build / install / test loop

```bash
# build
cd D:/输出目录/dsh2/spw-folia
"C:/Users/24037/Downloads/gradle-9.8.0/bin/gradle.bat" plugin --console=plain
# artifact: build/libs/plugin-dev.spw.folia-0.1.0.spmod
# build/plugin-root/ = host/ + web/ staged from packaging/native (preferred) or poc/webview dev dirs

# install + restart SPW (backs up enabled.txt/permissions.json, grants class-transform+library-read)
cd D:/输出目录/dsh2
bash spw-folia/scripts/install-local.sh --restart
```

Key config: `build.gradle.kts` → `syncDevAssets` copies `packaging/native/*` into `build/plugin-root/host`
when that dir exists (fallback `poc/webview/host/build`), `poc/webview/dist/dist` → `web/`,
`poc/settings-ui/dist/{settings-ui.js,assets,thumbs}` → `web/settings/`, plus default-settings.json.
`kapt(cffu pf4j + spw-workshop-api)` generates `META-INF/extensions.idx` (required, otherwise PF4J never
instantiates the `@Extension` playback class — this was the "time not flowing" bug).

Drive the E2E from the shell (deterministic coordinates: SPW forced to 200,200 1500×1081):

```powershell
& D:\输出目录\dsh2\poc\hook\cycle-test.ps1 -Name demo            # menu→Folia→ESC, checks alive/gone
& D:\输出目录\dsh2\poc\hook\cycle-test.ps1 -Name demo -StayOpen  # leaves window open for screenshots
& D:\输出目录\dsh2\poc\hook\orphan-test.ps1                      # spawn → kill SPW → orphan check → relaunch
```

Notes: the player bar reveals its buttons only on hover — move the cursor onto the bar (two moves) before
clicking `...` at physical `(1291,1175)` when SPW is at `(200,200,1500,1081)`; the 更多 flyout item
**Folia** row is at `(1285,1101)`. The menu-open step is verified through the plugin log
(`Folia item appended`) before the item click, so a covered/contested desktop fails loudly instead of
clicking blindly.

## 4. Plugin ↔ host contract (protocol v1, `docs/protocol.md`)

Spawn (cwd = plugin dir, inherited env + overrides):

```
<pluginPath>/host/spw-folia-host.exe --bundle <pluginPath>/web --fullscreen --bundle-version 0.1.0
# optional: --settings-dir <dir> --settings-entry settings-ui.js  (only when web/settings/settings-ui.js absent)
```

Env overrides (dev): `SPW_FOLIA_HELPER`, `SPW_FOLIA_WEB`, `SPW_FOLIA_SETTINGS`.
stdout/stderr are redirected by the plugin to `<pluginPath>/spw-folia-host.stdout.log` /
`spw-folia-host.stderr.log` (mirrored into the plugin log, first lines + throttled).

Plugin → host (stdin, JSON lines): `hello{protocol:1,pluginVersion,spwVersion,bundleDir}`,
`settings{settings:<opaque tree>}`, `state{posMs,durationMs,playing,rate,tsMs}` every 100 ms after
`ready`, `track{top-level id,title,artist,album,durationMs,coverDataUrl}`, `lyrics{lines:[{startMs,endMs,
main,sub,cells:[{startMs,endMs,text}]}]}` (replayed on ready and re-sent on version change), `quit`.

Host → plugin (stdout): `ready{protocol:1,pid,webviewVersion,bundle,startedAtMs}`, `closed{reason}`,
`settings{settings}` (persisted by `FoliaSettingsStore`), `action{name}`, `log{level,msg}`, `fps{…}`.

Lifecycle: spawn on item click → hello+settings → ready → state pump; `closed` ⇒ window gone, plugin stays
loaded (click reopens). `stop()`/`delete()` (plugin disable/unload) ⇒ quit + 2 s + force kill; SPW process
exit ⇒ stdio EOF ⇒ helper exits by itself (verified no orphan).

## 5. Known fragility / caveats

- **SPW pin 1.19.0 only.** Every host symbol used by the menu hook is R8-obfuscated (`ē`, `Ԭ`, `ন`,
  `ჰ$Ϳ`, …). Re-derive them per SPW version (`docs/hook-poc.md` has the exact RES/ASM method).
- Helper and plugin must be shipped from the **same packaging run**: an old host exe (pre-task-9) renders
  an 8×6 viewport when spawned by javaw. Build stages `packaging/native` first by design.
- WebView2 **user-data dir contention**: two helper instances launched by different owners on this shared
  desktop once produced `webview process-failed kind=BrowserProcessExited reason=Unexpected` after 40 s.
  The plugin treats that as `closed(reason=error)` and stays loaded; reopen works.
- Other agents/tools that `taskkill /IM spw-folia-host.exe` will kill the plugin's window too (observed
  during team testing). Acceptance checks must be run when the desktop is quiet.
- Coordinate clicking is the only SPW automation route (UIA exposes nothing on Compose Desktop); keep the
  SPW window at a known rect or re-derive the bar coordinates.
- The in-page settings **gear** icon is visible but a synthetic click on it did not open the overlay in our
  tests; the supported path is F1 / host `command:{open-settings}`. If product wants a clickable gear,
  that is the settings-UI owner's (task-5/8) seam; the bridge itself is verified working (overlay shows,
  ESC closes overlay first).
- No competing ESC handler in the plugin: ESC is handled by page Shim → host `closed(reason=user)`
  (overlay-open → only overlay closes). Verified in `task7-esc1/2` screenshots.
- Lyrics visibility depends on the playhead position (instrumental intros show the background only); the
  visualizer is fed by clock/track/lyrics and the style renders the lyric glyphs, not a subtitle track.
- `track` payload is large (~5.3 MB) because of the embedded cover data URL; sent once per track change.

## 6. Next-integration seam (audio spectrum, task-4)

The helper already accepts `{"t":"audio","power":…,"bands":[bass,lowMid,mid,vocal,treble],
"spectrum":[1024×0..255]}` and `{"t":"audioMode",…}`; the bridge builder is `FoliaHostBridge.sendAudio()`,
currently unused. Wiring audio-probe's spectrum provider into that method (throttled to the host's frame
cadence) is the remaining visual upgrade and needs no protocol change.
