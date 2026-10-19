# spw-folia — Folia lyric visualizer for Salt Player for Windows

Bring [Folia](https://github.com/chthollyphile/folia-major)'s lyric visualization system into
**Salt Player for Windows (SPW)** as a creative-workshop plugin: a `Folia` entry in the mini-player
**更多** menu opens a borderless fullscreen Folia mode powered by Folia's **own** rendering code
(all 14 lyric styles), driven by the music SPW is playing.

> Not affiliated with Folia or Salt Player. Folia is AGPL-3.0; this plugin is a derivative work and
> is licensed AGPL-3.0 too (see [LICENSE](LICENSE) and [docs/licensing.md](docs/licensing.md)).

[中文](README.md) | **English**

![Folia entry in the SPW mini-player 更多 menu](docs/images/menu-folia.png)

![Folia fullscreen mode with the injected Folia settings page](docs/images/settings-ui.jpg)

<p align="center"><img src="docs/images/fullscreen-chrome.jpg" width="88%" alt="Folia fullscreen visualizer with the ⚙ Folia settings button"></p>

<p align="center"><img src="docs/images/transparent-background.jpg" width="88%" alt="Transparent player background: the window is genuinely transparent, lyrics and effects float over the desktop, the switch sits at the bottom-right"></p>

## Features

- **Real Folia renderer, not a port** — the plugin hosts Folia 0.7.21's production
  OBS-browser-source bundle in WebView2; every style is Folia's original code, so motion, glow,
  word timing, backgrounds and transitions match Folia pixel for pixel.
- **All 14 lyric styles**: 商籁 (sonnet) · 凝彩 (tempera) · 绘光 (lumiere) · 流光 (classic) ·
  心象 (cadenza) · 云阶 (partita) · 浮名 (fume) · 倾诉 (tilt) · 回环 (claddagh) · 莫奈 (monet) ·
  时计 (pendolo) · 群唱 (cappella) · 镜台 (diorama) · 静止 (still).
- **Folia's settings page, 1:1** — the 「歌词样式」 window (tabs 歌词动画 / 背景 / 字体 / 字幕,
  14-style live grid, 默认 reset, 纹理分辨率, 镜头运动强度, 文字动势, per-style tunings)
  reusing Folia's own React components.
- **Live style preview in the settings page** (v0.1.6) — the big preview on the 「歌词样式」 page is
  not a static screenshot but Folia's real renderer running frame by frame inside a same-origin iframe:
  style, texture resolution, camera motion, typography, background and theme changes apply live, and
  the pause/play button genuinely freezes and resumes the picture.
- **Transparent player background** (v0.1.7; mouse passthrough since v0.1.9) — the round "sliders"
  button at the bottom-right corner of the fullscreen player opens a small panel with a
  **播放页透明背景 (transparent player background)** switch, placed exactly where SPW's own player page
  keeps its control button. When it is on, the helper window becomes a real colour-key transparent window
  and Folia stops drawing its background, so lyrics and effects float straight over the desktop or any
  other window (ideal for OBS / livestream overlays). The second row, **鼠标穿透（操作桌面）(mouse
  passthrough)**, sends clicks to the desktop while the gold button and the top-right gear stay
  clickable in every state. Both switches persist in the settings tree.
- **Cover-colour theming** — theme, background tint and accent are derived from the current track's
  album art (fixed in v0.1.2) and follow cover changes live.
- **Synced to SPW playback** — track, lyrics timeline (word-level cells), subtitle translation,
  play/pause/seek/rate are bridged from SPW's playback API plus a smooth interpolated timeline.
- **Audio-reactive** — WASAPI system-loopback capture with Folia-compatible 1024-bin spectrum and
  5-band gamma-mapped levels (power/bass/lowMid/mid/vocal/treble), computed inside the native helper.
- **No HTTP server, no network** — the helper maps a local bundle to a virtual https host; a tiny
  injected shim feeds Folia's EventSource protocol directly from the plugin over stdin/stdout.
- **AGPL-3.0 clean source** — plugin (Kotlin), helper (C#), settings UI (React/TS) and packaging are
  all in this repository.

### v1 limitations

- **智能动感模式 (Smart Beat) beat effects are not included in v1**: the Folia OBS surface exposes no
  beat events, and Folia's beat models (`beat_this` / `htdemucs`, ~133 MB) run in Folia's Electron main
  process and are not part of its web bundle. With smart beat off (Folia's default) every style renders
  identically to Folia. **Since v0.1.2/v0.1.3 the settings page no longer shows controls that could
  never take effect** (smart beat, beat effects, romanised/duet subtitles, custom fonts, custom
  backgrounds, asset uploads); every remaining control has a real effect. Details:
  [docs/known-inert-settings.md](docs/known-inert-settings.md).
- **Windows only** (the helper uses WebView2 + Windows WASAPI).
- **Pinned to Salt Player for Windows 1.19.0** — the menu hook targets one host build
  (SPW's internal names are obfuscated per release); the plugin refuses to install the hook on other
  versions. See [docs/hook-target.md](docs/hook-target.md).
- **Transparent mode captures the mouse by default**: the transparent window covers the desktop and
  takes clicks for Folia (in-page controls are clickable since v0.1.8). To use the desktop or other apps
  while staying transparent, turn on **鼠标穿透（操作桌面）(mouse passthrough)** in the panel — the gold
  button and the top-right gear (plus the panel/settings they open) remain clickable in every state.
  You can also press **Ctrl+Alt+B** (fallbacks Ctrl+Alt+Y / Ctrl+Alt+P / Ctrl+Alt+Shift+B) or ESC to
  exit playback. Details: [docs/live-transparency.md](docs/live-transparency.md).
- No music library writing; the plugin only reads playback state + the current track/lyrics/cover.

## What's new in v0.1.10

- **Fixed: scrolling the wheel down crashed the helper in transparent mode** — the v0.1.9 input-catcher
  read message parameters with `IntPtr.ToInt32()`. On x64 that is a *checked* narrowing conversion, while
  Win32 delivers parameters zero-extended: wheel-down has delta `-120`, so the low dword of `WPARAM` is
  `0xFF88xxxx` with bit31 set, and the conversion threw `OverflowException: 算术运算导致溢出`. The
  exception escaped `WndProc`, WinForms showed its "Microsoft .NET Framework" unhandled-exception dialog
  and the helper died. Now uses `unchecked((int)x.ToInt64())`, and the wheel branch reads the right
  fields (screen coordinates live in `LPARAM`, the delta in `WPARAM`).
- **Unhandled exceptions are logged** — the helper now registers `Application.ThreadException` and
  `AppDomain.UnhandledException`, so a future UI-thread failure emits a `level=error` protocol line
  instead of leaving only a modal dialog behind.
- Details: [docs/verification-v0.1.10.md](docs/verification-v0.1.10.md).

## What's new in v0.1.9

- **Mouse passthrough switch** — the panel behind the gold round button now has a second row,
  **鼠标穿透（操作桌面）** (only while the transparent background is on). Off by default, so the
  transparent window keeps taking clicks for the page (v0.1.8 behaviour). On, clicks go to the desktop /
  whatever sits below, while the gold button, the top-right gear, the panel and the whole settings page
  stay clickable.
- **Both chips are always clickable** — the page reports its hot rectangles (gold button, gear, open
  panel, settings overlay) to the helper: the invisible input-catcher only forwards the mouse inside
  those rectangles and, outside them (passthrough on), hides itself, synthesises one real left click and
  restores after 220 ms. So one transparent window can drive both Folia and the desktop.
- **Bottom-left chip removed** — the "restore opacity" badge window from v0.1.7/v0.1.8 is gone; the
  **Ctrl+Alt+B** toggle stays, and leaving transparency also resets `mousePassthrough`, so the next
  transparent session never starts in passthrough mode by accident.
- Mechanism: [docs/live-transparency.md](docs/live-transparency.md); verification:
  [docs/verification-v0.1.9.md](docs/verification-v0.1.9.md).

## What's new in v0.1.8

- **Lyrics switch with the track** — the bridge used to push lyrics only when the track payload changed,
  so after an automatic track change the fullscreen page kept the previous lyrics for seconds. It now
  compares and pushes lyrics on every 100 ms tick (measured: `track` and `lyrics` 2 ms apart) and polls
  the track every 200 ms instead of every second.
- **Covers and theme keep up** — cover loading starts the moment a new track is adopted (0.4 s throttle,
  de-duplicated per track) and oversized covers are shrunk to 512 px before becoming data URLs; in the
  real app the track with cover reaches the page in ~0.4 s (worst case used to be 3–4 s). On the page,
  when the cover has not arrived yet the previous palette is kept, so the theme no longer flashes back to
  the default night colours.
- **Clickable while transparent** — transparency no longer means "whole window click-through, hotkey
  only": the helper adds an invisible input-catcher window (alpha = 1/255, `WS_EX_NOACTIVATE`) that
  forwards mouse messages to WebView2's input child window. The gold button, panel, switch and gear are
  all clickable while transparent (verified live: clicking the switch while transparent turns opacity
  back on immediately).
- **Escape hatches kept** — the bottom-left chip and **Ctrl+Alt+B** still toggle both ways as a fallback;
  the chip text now reads "点开关或 Ctrl+Alt+B 恢复不透明".
- Mechanism: [docs/live-transparency.md](docs/live-transparency.md); verification:
  [docs/verification-v0.1.8.md](docs/verification-v0.1.8.md).

## What's new in v0.1.7

- **Transparent player background** — a gold round "sliders" button now sits at the bottom-right of the
  fullscreen player, at the same spot as SPW's own player-page control button. It opens a panel with a
  **播放页透明背景** switch (same row layout as SPW's setting). Turning it on makes the helper window a
  colour-key transparent window and sends `background.transparent=true`, so Folia skips its background
  renderer while the page keeps its own transparent document background: lyrics and effects truly float
  over the desktop instead of rendering black.
- **A way out of transparent mode** — colour-key windows are mouse click-through, so once transparency
  is on the in-page buttons cannot be clicked. The panel keeps a hint, a small non-activating chip is
  shown at the bottom-left, and **Ctrl+Alt+B** (fallbacks Ctrl+Alt+Y / Ctrl+Alt+P / Ctrl+Alt+Shift+B)
  restores opacity, flips the switch back off through a page hook and persists that state (this also
  fixes a state-desync bug where re-enabling right after an escape did nothing). ESC still exits playback.
- **Colour fidelity** — colour-key composition drops `backdrop-filter` layers (without the fix the chrome
  vanished on screen), so while transparency is on the chrome stays visible and switches to a flat,
  blur-free style; the frosted glass comes back when the window is opaque again.
- **No plugin changes** — the new `transparentPlayerBackground` field rides the existing settings tree
  (the plugin persists the tree verbatim); the helper reads it from the settings JSON and switches the
  window, so the state survives restarts.
- Mechanism and limits: [docs/live-transparency.md](docs/live-transparency.md); verification:
  [docs/verification-v0.1.7.md](docs/verification-v0.1.7.md).

![Transparent player background: the window is genuinely transparent, lyrics and effects float over the desktop, the switch is at the bottom-right](docs/images/transparent-background.jpg)

## What's new in v0.1.6

- **The settings-page big preview now runs the real Folia renderer** — instead of a static style frame,
  the 「歌词样式」 preview hosts Folia's own OBS page and rendering pipeline in a same-origin
  `preview.html` iframe, so style, texture resolution, camera motion, text dynamics, fonts, background
  and theme changes apply live; the pause/play button really freezes and resumes the picture. The
  v0.1.5 static Ken Burns frame remains only as a fallback when the iframe is unavailable.
- **Pause means fully static** — the child frame wraps `requestAnimationFrame` with an rAF gate at
  `document_start`, so while paused the renderer/particle/grain loops stop entirely and resume flushes
  the queue; hiding the overlay freezes the child frame so the hidden 1080p renderer does not spin.
- **Lightweight wiring** — the renderer runs only in the child frame; the settings bundle grows by just
  ~12 KB (~1.06 MB) and the release package by ~0.7 MB vs v0.1.4. A 4 s readiness timeout falls back to
  the static frame, and five open/close cycles reuse the same iframe without leaks.
- **Host fix** — `hello`/`settings` received before WebView2 is ready no longer triggers a `post-page`
  null reference; cached lyrics/track are replayed after a page reload.
- Evidence: [docs/verification-live-preview-ui.md](docs/verification-live-preview-ui.md) (probe
  11/11 PASS, paused visible-area frame diff ratio 0.00000 / mean 0); the contract with the main
  publisher is in [docs/live-preview-iframe.md](docs/live-preview-iframe.md).

![The settings-page big preview drawn live by the real Folia renderer inside an iframe](docs/images/live-preview.jpg)

## What's new in v0.1.4

- **Fixed the lyric-style preview not following the selected style** — the big preview's crossfade
  was driven by an effect keyed on `[src, current]`; `setCurrent()` retriggered the effect and its
  cleanup cancelled the fade timers, so after the first switch the new frame stayed at opacity 0 while
  the old one remained visible. It now uses an effect keyed on the target `src` only plus a CSS
  `spw-preview-in` fade (220 ms): clicking any style tile instantly updates the preview, the parameter
  panel and the selection highlight, even with rapid switching.
- Evidence: [docs/verification-v0.1.4.md](docs/verification-v0.1.4.md).

## What's new in v0.1.3

- **Mod manager author is now the GitHub account** — the plugin manifest `Plugin-Provider` changed from
  `dsh2 team` to **`azkbzxf`**, so the author column in SPW's mod manager matches GitHub.
- **All inert controls removed** — on top of the v0.1.2 智能动感模式 removal, v0.1.3 removes every
  control that could never take effect (see [docs/known-inert-settings.md](docs/known-inert-settings.md)):
  beat effects, custom/system fonts, romanised & duet subtitles, custom/URL backgrounds, and the
  upload-type controls (tempera layer images, Monet portrait, Cappella avatars/emoji). They are stripped
  at build time without touching the upstream Folia sources; every remaining control has an effect.
- **Fixed font/subtitle settings** — font family (sans/serif/mono) and weight are now written to
  `theme.fontStyle` / `theme.fontWeight`; subtitle fonts inherit the lyric theme or apply their own;
  the subtitle content mode is normalised to translation. Legacy persisted values are migrated.
- Evidence: [docs/verification-v0.1.3.md](docs/verification-v0.1.3.md).

![spw-folia 0.1.3 in the mod manager: author azkbzxf](docs/images/mod-manager.jpg)

## What's new in v0.1.2

- **Cover colour fixed** — the plugin sends the cover as `coverDataUrl`, but the settings page only
  read `coverUrl`, so the derived theme always stayed on the default dark palette. The host now emits
  both spellings and the page falls back to `coverDataUrl`; the fullscreen theme/background/accent now
  follow the current album art (orange cover → warm theme, near-black cover → neutral; see
  [docs/images/cover-color.jpg](docs/images/cover-color.jpg) and
  [docs/verification-v0.1.2.md](docs/verification-v0.1.2.md)).
- **「智能动感模式」 switch removed** — stripped from the settings page at build time (other cards are
  untouched), since the beat models are not in the web bundle.
- **Inert controls documented** — see [docs/known-inert-settings.md](docs/known-inert-settings.md).

## What's new in v0.1.1

- **The Folia menu entry now looks like a first-class host item** — same row layout as
  播放速度 / 桌面歌词 / 歌词翻译 / 释放音频引擎: 19 dp sparkle icon tinted with the host content colour,
  14 sp label, identical spacing and disabled alpha.
- **Cursor auto-hide fixed** — in fullscreen the pointer hides after 2.5 s of inactivity, reappears on
  movement, and is forced visible while the 歌词样式 overlay is open. (v0.1.0 hid the pointer permanently,
  so the ⚙ gear could not be clicked.)
- **Settings overlay reliability** — fixed a page↔host UI-state echo loop that could leave the panel
  blank/flapping; the panel now scrolls correctly and reopens instantly.

## Verified end-to-end

The shipped payload was validated in real Salt Player for Windows 1.19.0 (MS channel) on Windows 11:

| check | evidence |
| --- | --- |
| **Folia** item appears in the mini-player 更多 flyout and opens the fullscreen renderer | [docs/plugin-integration.md](docs/plugin-integration.md) §1, `poc/hook/shots/task7-*` |
| Fullscreen 3200x2000 at 175% DPI, page 1776x1110 dpr1, 3 canvases, 110-120 fps; stable 16-min soak (66-67.5 MB working set) | [docs/acceptance-report.md](docs/acceptance-report.md) T8 |
| Playhead + word-level lyrics advance from SPW playback (100 ms interpolated timeline); pause/resume and seek follow | [docs/plugin-integration.md](docs/plugin-integration.md) §1, [docs/acceptance-report.md](docs/acceptance-report.md) T1-T3 |
| Real mouse input: hover ⚙ opens the 歌词样式 overlay, ← returns to the renderer, ESC closes (exit 0) | [docs/acceptance-report.md](docs/acceptance-report.md) T-G1..G3 |
| v0.1.6: the settings-page big preview is the real Folia renderer inside an iframe (3 canvases, paused frame diff 0.00000, instant style switch, one reused iframe across 5 open/close cycles, 0 page errors) | [docs/verification-live-preview-ui.md](docs/verification-live-preview-ui.md) |
| v0.1.7: transparent player background (colour-key window really transparent, desktop shows through, bottom-left chip / Ctrl+Alt+B restores opacity and syncs the page switch, re-enable after an escape works, settings tree persisted, ESC exits, chrome still visible while transparent) | [docs/verification-v0.1.7.md](docs/verification-v0.1.7.md) |
| v0.1.8: lyrics switch with the track (`track`/`lyrics` 2 ms apart), cover shrunk in 0.2 s and on the page in 0.4 s, previous theme kept while a cover is missing; in-page mouse works while transparent (clicking the switch while transparent → `mode=off` + catcher hidden) | [docs/verification-v0.1.8.md](docs/verification-v0.1.8.md) |
| v0.1.9: mouse passthrough (`passthrough=on rects=3` → desktop click `passthrough=click at=1600,560` → catcher restored), gold button/gear/settings-page back button clickable while passthrough is on, hotkey exit leaves `mode=off` + `passthrough=off` | [docs/verification-v0.1.9.md](docs/verification-v0.1.9.md) |
| v0.1.10: wheel-down crash fixed (old helper throws `OverflowException` and shows the "Microsoft .NET Framework" dialog on `WM_MOUSEWHEEL wparam=0xFF880000`; new helper passes 15/15 reflection checks and 0 dialogs / 0 error lines live) | [docs/verification-v0.1.10.md](docs/verification-v0.1.10.md) |
| **Folia** item matches host menu typography/sparkle icon (v0.1.1); **cover-colour theming** follows the album art (v0.1.2: orange vs black cover mean RGB 165/105/66 vs 71/71/72); **v0.1.3**: mod-manager author = `azkbzxf`, inert controls removed, font family/weight + subtitle fonts effective | [docs/images/menu-folia.png](docs/images/menu-folia.png), [docs/images/cover-color.jpg](docs/images/cover-color.jpg), [docs/verification-v0.1.3.md](docs/verification-v0.1.3.md) |
| Settings/style persist across an SPW restart; disabling the plugin restores the 4-item menu; 5 open/close cycles and killing SPW leave no orphan helper | [docs/acceptance-report.md](docs/acceptance-report.md) T5-T7, T-E1 |
| All 14 styles render from the release payload (15/15 sweep, 0 page errors, 0 external network); RC payload unpacked in a clean dir passes 19/19 layout/protocol checks | [docs/release-candidate.md](docs/release-candidate.md) |
| Full acceptance matrix (track change / seek / pause / no-lyrics / lifecycle / persistence / soak) | [docs/acceptance-run.md](docs/acceptance-run.md), [docs/acceptance-report.md](docs/acceptance-report.md) |

<p align="center"><img src="docs/images/style-grid.png" width="82%" alt="All 14 Folia lyric styles in the settings window"></p>

## Install

Requirements: Windows 10/11 x64, **Salt Player for Windows 1.19.0**, WebView2 Runtime (preinstalled on
Windows 11; Windows 10 can install "Microsoft Edge WebView2 Runtime").

1. Download `spw-folia-0.1.10.spmod` from the [Releases](https://github.com/azkbzxf/spw-folia/releases) page (Windows x64).
2. In SPW: **设置 → 插件 / 创意工坊 → 导入插件**, pick the `.spmod`, then enable it and grant
   **class-transform** (`钩子`) permission when asked (the plugin needs it for the 更多-menu hook).
3. Restart SPW if the plugin manager asks for it.
4. Play a song, open the mini player's **更多** (…) menu → **Folia**.

The first run opens Folia's settings window; afterwards the visualizer opens directly (⚙ top-right
opens settings; ESC closes settings first, then the window). Settings are stored in SPW's plugin
data directory.

## Build from source

Toolchain: JDK 25, Gradle 9.8 (wrapper included), Kotlin 2.4.20, Node 24 + pnpm (settings UI),
Windows in-box `csc.exe` (.NET Framework 4.8) for the native helper. No .NET SDK and no Android SDK.

```bat
:: 1) plugin (Kotlin, official SPW workshop Gradle plugin)
cd spw-folia
gradlew.bat plugin          :: -> build/libs/plugin-dev.spw.folia-0.1.10.spmod

:: 2) native helper (C# + WebView2)
cd ..\poc\webview\host
bash build.sh               :: -> build/spw-folia-host.exe (+ WebView2 dlls)

:: 3) settings UI (React)
cd ..\..\settings-ui
pnpm install && pnpm build  :: -> dist/settings-ui.js

:: 4) assemble the distributable .spmod (plugin classes + staged web bundle + native + licenses)
bash packaging/build-package.sh     :: stages packaging/{web,native,licenses} + SHA256SUMS
python packaging/tools/assemble-release.py ^
    --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.10.spmod ^
    --staging packaging --out dist/release --name spw-folia-0.1.10.spmod
::    see docs/release.md for the full, scripted assembly and local-install test loop.
```

Project layout:

```
spw-folia/       Kotlin plugin (hook, playback bridge, timeline, config, helper process manager)
poc/webview/     native helper sources (C# WinForms + WebView2) and dev server/driver
poc/settings-ui/ Folia settings window (React island reusing Folia's components)
poc/audio/       WASAPI loopback analyzer (C#) + timeline notes
packaging/       staged web bundle + native payload + licenses + release docs
docs/            architecture, protocol, host app, hook target, Folia spec, licensing
research/        Folia style/settings research notes (AGPL; reference assets are not committed)
```

## Architecture (short version)

```
SPW (JVM)                                    spw-folia-host.exe (C#/WebView2)
┌──────────────────────────┐  stdin/stdout   ┌───────────────────────────────────┐
│ spw-folia plugin         │  JSON-lines     │ borderless fullscreen window      │
│  MenuHook (更多 → Folia) │ ──────────────▶ │  Folia OBS bundle (React)         │
│  PlaybackBridge ────────▶│ state/lyrics/   │  injected EventSource shim        │
│  Timeline (smooth pos)   │ track/settings  │  injected Folia settings UI       │
│  ConfigStore             │ ◀────────────── │  WASAPI loopback → audio frames   │
└──────────────────────────┘ ready/closed/…  └───────────────────────────────────┘
```

Details: [docs/architecture.md](docs/architecture.md) · wire protocol:
[docs/protocol.md](docs/protocol.md) · native host: [docs/host-app.md](docs/host-app.md) ·
Folia spec: [docs/folia-spec/](docs/folia-spec/) · licensing: [docs/licensing.md](docs/licensing.md).

## Credits

- [Folia](https://github.com/chthollyphile/folia-major) by chthollyphile (AGPL-3.0) — the entire
  visualizer, settings UI and web bundle are Folia's work (v0.7.21).
- [Salt Player for Windows](https://saltplayer.com/) workshop plugin API by Moriafly.
- [spw-island (Dynamic Lyrics Island for SPW)](https://github.com/gaboron/spw-island) — behavioral
  reference only (GPL-3.0); no code copied.
- Microsoft Edge WebView2 SDK, .NET Framework, Kotlin/Compose, React/Vite.

## License

AGPL-3.0-or-later. This repository contains derivative work of Folia and is distributed in the hope
that it will be useful, but WITHOUT ANY WARRANTY. See [LICENSE](LICENSE),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the source offer in [docs/licensing.md](docs/licensing.md).
