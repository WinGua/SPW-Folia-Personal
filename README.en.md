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
- No music library writing; the plugin only reads playback state + the current track/lyrics/cover.

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
| **Folia** item matches host menu typography/sparkle icon (v0.1.1); **cover-colour theming** follows the album art (v0.1.2: orange vs black cover mean RGB 165/105/66 vs 71/71/72); **v0.1.3**: mod-manager author = `azkbzxf`, inert controls removed, font family/weight + subtitle fonts effective | [docs/images/menu-folia.png](docs/images/menu-folia.png), [docs/images/cover-color.jpg](docs/images/cover-color.jpg), [docs/verification-v0.1.3.md](docs/verification-v0.1.3.md) |
| Settings/style persist across an SPW restart; disabling the plugin restores the 4-item menu; 5 open/close cycles and killing SPW leave no orphan helper | [docs/acceptance-report.md](docs/acceptance-report.md) T5-T7, T-E1 |
| All 14 styles render from the release payload (15/15 sweep, 0 page errors, 0 external network); RC payload unpacked in a clean dir passes 19/19 layout/protocol checks | [docs/release-candidate.md](docs/release-candidate.md) |
| Full acceptance matrix (track change / seek / pause / no-lyrics / lifecycle / persistence / soak) | [docs/acceptance-run.md](docs/acceptance-run.md), [docs/acceptance-report.md](docs/acceptance-report.md) |

<p align="center"><img src="docs/images/style-grid.png" width="82%" alt="All 14 Folia lyric styles in the settings window"></p>

## Install

Requirements: Windows 10/11 x64, **Salt Player for Windows 1.19.0**, WebView2 Runtime (preinstalled on
Windows 11; Windows 10 can install "Microsoft Edge WebView2 Runtime").

1. Download `spw-folia-0.1.3.spmod` from the [Releases](https://github.com/azkbzxf/spw-folia/releases) page (Windows x64).
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
gradlew.bat plugin          :: -> build/libs/plugin-dev.spw.folia-0.1.3.spmod

:: 2) native helper (C# + WebView2)
cd ..\poc\webview\host
bash build.sh               :: -> build/spw-folia-host.exe (+ WebView2 dlls)

:: 3) settings UI (React)
cd ..\..\settings-ui
pnpm install && pnpm build  :: -> dist/settings-ui.js

:: 4) assemble the distributable .spmod (plugin classes + staged web bundle + native + licenses)
bash packaging/build-package.sh     :: stages packaging/{web,native,licenses} + SHA256SUMS
python packaging/tools/assemble-release.py ^
    --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.1.3.spmod ^
    --staging packaging --out dist --name spw-folia-0.1.3.spmod
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
