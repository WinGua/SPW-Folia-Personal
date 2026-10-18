> **SUPERSEDED**: 本文件是 task-13 的中途快照（旧构建 / 旧 layout）。最终产物
> `dist/release/spw-folia-0.1.0.spmod`（sha256 `8c265dc1…`）的完整验收矩阵、soak 数据与结论见
> **`docs/acceptance-report.md`**（canonical）。本文件保留作为过程记录。

# Acceptance matrix run — task-13 (installed build, real SPW 1.19.0)

Date: 2026-10-18 23:00–23:25 (Asia/Shanghai)
Build under test: installed plugin `dev.spw.folia` 0.1.0 (dir
`%APPDATA%\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY`), web bundle from
`poc/webview/dist/dist` + settings UI from `poc/settings-ui/dist`, helper re-staged from
`packaging/native` (task-9 build).

Installed payload identity (not modified during this run):
- `host/spw-folia-host.exe` sha256 `de8bd433aa818fc5969c0a7fbf16097f745566e724c2f750aef30ffa2704c879` (114,176 B)
- `host/Microsoft.Web.WebView2.Core.dll` sha256 `d60e6e94245078cb56e44ebd5f360dc04bf18e460136be93bfc4cfca43b98505`
- `web/index.html` bundle, `web/settings/settings-ui.js` (packaged web, unchanged)
- Build artifact `spw-folia/build/libs/plugin-dev.spw.folia-0.1.0.spmod` sha256 `3eea15aec24ec969b3d66091567d8c84c3346ca94937a50f55b933d69f66debf`

Driver: `poc/hook/acceptance-session.ps1`, `poc/hook/cycle-test.ps1`, `poc/hook/drive.ps1`,
`poc/hook/lifecycle-test.ps1`, `poc/hook/orphan-test.ps1`. Media/seek input via global media keys and
SPW's arrow-seek when SPW has focus; helper input via focus + F1/ESC.

## PASS/FAIL table

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Track change next/prev while Folia window open | **PASS** | media NEXT/PREV: log `track -> helper (5349901 bytes)`, `lyrics -> helper (27513/29917 bytes)`; helper stayed alive; screenshots `acc1-next-0.png`, `acc1-prev-0.png` show the new track's lyric frame (song-credit line "词/许嵩"); automatic end-of-track advance also observed (duration 272298 → 246784, replayed track/lyrics) |
| 2 | Seek → onSeekTo → clock jump → different lyric line | **PASS (keyboard seek; progress-bar click not locatable)** | `callback seek first: 45208`; `callbacks/10s … seek=` 2→3→5; position jump ≈ +5 s / +10 s beyond natural playback; reopened window at the new position (`acc1-seekposA-0.png` ≈60 s lyric frame vs `acc1-seekposB-0.png` ≈120 s frame) |
| 3 | Pause/resume freeze + continue | **PASS** | media play/pause: log `state -> helper: pos=3389 … playing=false` (stable across two 2.6 s screenshots `acc1-pausedA/B`) then `pos=3464 … playing=true` and `state #200 posMs=10319` (`acc1-resumed-0.png`) |
| 4 | No-lyrics / instrumental track renders, no crash | **PARTIAL** | renderer with zero lyric lines verified at spawn/first frames (`t7c-folia-click-0.png`, `t7i-open-0.png`: background-only render, state flowing, no errors). Selecting a dedicated instrumental track via list automation failed in the shared desktop (list rows for the 1-h "旅途的足迹" instrumentals did not take; clicks landed on the previous page) — bridge/plugin side handles `lines: []` by sending an empty array and the page keeps rendering; not re-verified on a guaranteed no-lyrics file |
| 5 | Plugin lifecycle: disable → no helper/item; re-enable → works | **PASS** | `enabled.txt` without `dev.spw.folia` + restart: plugin `start` lines stayed 1, 更多 flyout shows only the 4 host items (`acc1-lifecycle-disabled-menu-0.png`); restored line + restart: start lines 2, `playback extension discovered`, menu appends Folia again, click spawns helper (pid 19112) |
| 6 | Settings persistence (style 凝彩) | **PASS** | F1 overlay → click 凝彩 → `host settings update (5292 bytes)`; persisted `workshop/data/dev.spw.folia/config.json` (5,853 B) with `settingsJson.styleId = "tempera"`; close window + reopen → overlay still shows 凝彩 selected (`acc1-settings-restored-0.png`), style-specific panel (画布图片/动态与调色) restored |
| 7 | Rapid open/close ×5 → exactly one helper, no orphans | **PASS** | 5 cycles: each `Folia item clicked` → `host spawned pid=…` → `host closed reason=user` → `host process exited code=0`; final helper count 0; no stray processes (`acc1-cycle1..5-open/esc`) |
| 8 | 10-minute soak (playing, window open) | **RE-RUN** | first attempt invalidated: soak helper pid 19112 closed externally at 23:14:29 (`{"t":"closed","reason":"user"}`) while no automation was touching input; clean re-run started 23:19 with sampler `poc/hook/logs/soak-acc1b.log` (results appended below) |

Also re-verified in this run: ESC semantics per protocol §7.5 — with the settings overlay open, ESC #1
closes only the overlay (helper stays alive), ESC #2 closes the window (`host closed reason=user`,
exit 0). F1 opens the overlay. The in-page ⚙ gear did not respond to synthetic clicks (page-layer
issue, owned by webview-spike/task-12; plugin/host paths are unaffected).

## Notes / caveats (not plugin bugs)

- Shared desktop: another agent's fullscreen windows, plus the user's own Folia.exe fullscreen app,
  occasionally covered SPW and stole clicks/keyboard focus. All final evidence was taken when SPW or
  the helper was the foreground window; runs under contention were discarded.
- `cycle-test.ps1`'s "menu did not open" check can false-negative when the 更多 composition is reused
  (no new `Folia item appended` line is logged even though the flyout opens). Verify spawn via the
  plugin log instead.
- Player-bar buttons (incl. `...`) only appear on hover; the compact/now-playing bar exposes no
  clickable progress bar in the two views probed, so seek was exercised with SPW's ←/→ seek keys
  (same `PlaybackExtensionPoint.onSeekTo` → `TimelineController` path).
- WebView2 content ~5 MB per track change (cover as data URL in `track`) — expected, sent once per
  track.
- No plugin-side bugs required code changes during this matrix; `lifecycle-test.ps1` needed a
  PowerShell scalar-vs-array fix (test script only).

## Release-ready summary

- Host helper + web bundle + plugin are byte-identical to the re-staged packages (host exe sha256
  `de8bd433…`, spmod sha256 `3eea15ae…`); the installed payload was not modified during acceptance.
- Plugin config lives only in `workshop/data/dev.spw.folia/config.json` (opaque settings tree).
- Remaining known product caveats for release notes: real-mouse click on the in-page ⚙ gear is still
  under verification (task-12; F1 works); seek works via keyboard/media integration but the compact
  bar has no visible progress control; no-lyrics track selection was not re-verified end-to-end (no
  dedicated instrumental in the auto-drivable part of this library).
