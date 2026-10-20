# spw-folia — Folia lyric visualizer for Salt Player for Windows

Bring [Folia](https://github.com/chthollyphile/folia-major)'s lyric visualization system into
**Salt Player for Windows (SPW)** as a creative-workshop plugin: a `Folia` entry in the mini-player
**More** menu opens a borderless fullscreen Folia mode powered by Folia's **own** rendering code
(all 14 lyric styles), driven by the music SPW is playing.

> Not affiliated with Folia or Salt Player. Folia is AGPL-3.0; this plugin is a derivative work and
> is licensed AGPL-3.0 too (see [LICENSE](LICENSE) and [docs/licensing.md](docs/licensing.md)).

[中文](README.md) | **English**

![Folia entry in the SPW mini-player More menu](docs/images/menu-folia.png)

<p align="center"><img src="docs/images/fullscreen-chrome.jpg" width="88%" alt="Fullscreen Folia visualizer with the ⚙ settings button"></p>

<p align="center"><img src="docs/images/transparent-background.jpg" width="88%" alt="Transparent playback page: lyrics composited straight onto the desktop, toggle panel at the bottom right"></p>

<div align="center"><sub>Transparent playback page: Folia paints only lyrics and effects; the rest of the window is genuinely transparent (toggle panel at the bottom right).</sub></div>

## Features

- **Runs real Folia, not a port** — the plugin hosts Folia 0.7.21's production OBS browser-source
  build inside WebView2; every style is Folia's original code, so motion, glow, per-character
  timeline, backdrops and transitions match Folia pixel for pixel.
- **All 14 lyric styles**: 商籁 (sonnet) · 凝彩 (tempera) · 绘光 (lumiere) · 流光 (classic) ·
  心象 (cadenza) · 云阶 (partita) · 浮名 (fume) · 倾诉 (tilt) · 回环 (claddagh) · 莫奈 (monet) ·
  时计 (pendolo) · 群唱 (cappella) · 镜台 (diorama) · 静止 (still).
- **Folia's settings page, 1:1** — the "歌词样式" window (four tabs: lyrics animation / backdrop /
  font / subtitles; a live 14-style grid; Reset; texture resolution, camera motion, text motion and
  per-style extra options) reuses Folia's own React components. The large preview on the left is the
  real renderer running frame-for-frame in a same-origin iframe.
- **Transparent playback page + click-through** — the round button cluster at the bottom right of the
  fullscreen page toggles *播放页透明背景*: the host window becomes a real transparent window and Folia
  stops painting a backdrop, so lyrics and effects sit directly on the desktop or over other windows
  (OBS overlay / streaming). The second row, *鼠标穿透（操作桌面）*, lets clicks fall through to the
  desktop while the dial, the gear and the settings page stay clickable. The toggle persists in the
  settings tree, and **Ctrl+Alt+B** (fallbacks Ctrl+Alt+Y / Ctrl+Alt+P / Ctrl+Alt+Shift+B) restores
  opacity at any time. Transparency is a colour-key composite, so the 14 styles fall into three
  compatibility tiers: natively supported (11), auto-simplified while transparent (tempera / lumiere /
  pendolo / still — restored when transparency is switched off) and unsupported (monet, and lumiere
  under the light theme; selecting one switches transparency off and explains why).
- **Cover-driven colour** — theme, backdrop and accent colours derive from the current track's cover
  art and change live as the cover changes.
- **Synced with SPW playback** — track, cover, per-character lyric timeline, translation subtitles,
  play/pause/seek/speed all come from the SPW playback API plus a smoothing interpolation timeline.
- **Audio-reactive** — WASAPI loopback capture in the native helper yields Folia-compatible 1024-bin
  spectra and 5-band gamma-mapped levels (power/bass/lowMid/mid/vocal/treble).
- **No HTTP server, no network** — the helper maps the local bundle onto a virtual https host and a
  small injected shim feeds Folia's EventSource protocol over stdin/stdout.
- **Full AGPL-3.0 sources** — plugin (Kotlin), helper (C#), settings UI (React/TS) and packaging
  scripts all live in this repo.

### v1 limitations

- **Smart-motion beat FX are not included**: Folia's OBS interface exposes no beat events; the beat
  models (`beat_this` / `htdemucs`, ~133 MB) run in Folia's Electron main process, not its web
  bundle. With smart motion off (Folia's default) every style renders exactly as Folia does. All
  settings that cannot take effect (smart motion, motion effects, romaji/harmony subtitles, custom
  font, custom backdrop, asset upload, …) have been removed from the settings page — only controls
  with real effect remain; see [docs/known-inert-settings.md](docs/known-inert-settings.md).
- **Windows only** (the helper needs WebView2 + Windows WASAPI).
- **Pinned to Salt Player for Windows 1.19.0** — the menu hook targets that host version (SPW's
  internal names change with each release and obfuscation), and the plugin refuses to install the
  hook on other versions. See [docs/hook-target.md](docs/hook-target.md).
- It does not write to your music library; it only reads playback state, the current track, lyrics
  and cover art.

## Version history

Downloadable artifacts for every release (`.spmod` + `SHA256SUMS.txt`) are on
[GitHub Releases](https://github.com/azkbzxf/spw-folia/releases). Per-release notes are no longer
kept in the repository; for archaeology see [docs/archive/](docs/archive/) (historical release
notes, verification reports and acceptance evidence — kept for traceability only).

| Version | Summary |
| --- | --- |
| **v0.2.1** | The Folia entry in the More menu follows the host theme under the light theme; CLR activation failure fixed for the Store (MSIX) channel |
| v0.2.0 | Transparent-window style compatibility tiers (native / tuned / unsupported); fixed the stale stdin-writer thread leaking after a bridge restart; hardened the host stdout path with a bounded non-blocking queue; added [runtime requirements & troubleshooting](docs/runtime-requirements.md) |
| v0.1.11 * | Fixed an unconditional crash from the stdin pump touching WebView2 cross-thread (could also freeze SPW); fixed plugin write-pipe blocking that froze SPW |
| v0.1.10 | Fixed `OverflowException` crash in the helper when scrolling down in transparent mode; unhandled exceptions are now logged |
| v0.1.9 | Added *鼠标穿透（操作桌面）* to the button panel; the dial, gear and panel hitboxes stay clickable; removed the persistent bottom-left pommel |
| v0.1.8 * | Lyrics switch with the track (independent lyric polling), faster cover/theme follow, the mouse is clickable inside the transparent window |
| v0.1.7 | Transparent playback page (colour-key transparent window + Ctrl+Alt+B restore); chrome stays unblurred while transparent |
| v0.1.6 | The settings-page preview is now the real Folia renderer in an iframe (fully still when paused) |
| v0.1.5 * | Settings preview gained a Ken Burns drift and a working pause/play button (replaced by the real renderer in v0.1.6) |
| v0.1.4 | Fixed the style preview not following the selected style (crossfade effect cancelling itself) |
| v0.1.3 | Mod-manager author is now `azkbzxf`; removed every setting that could not take effect; fixed font/subtitle settings being inert |
| v0.1.2 | Fixed cover-colour theming (`coverDataUrl` / `coverUrl` mismatch); removed the smart-motion switch |
| v0.1.1 | The More-menu entry now matches the host's native items; cursor auto-hide and settings-panel loop fixes |
| v0.1.0 | First release: menu hook, fullscreen Folia renderer, 14 styles, settings page, audio analysis |

`*` marks builds that were only ever made locally and never published to GitHub Releases (their
changes shipped inside the following releases).

The release artifacts were accepted end-to-end on a real SPW 1.19.0 on Windows 11 (menu entry →
fullscreen render, 14-style 15/15 sweep, 0 page errors, 0 external network requests, 16-minute soak,
settings persistence, no orphaned helper processes). Full matrix in
[docs/archive/acceptance-report.md](docs/archive/acceptance-report.md).

<p align="center"><img src="docs/images/style-grid.png" width="82%" alt="All 14 Folia lyric styles in the settings window"></p>

## Install

Requires Windows 10/11 x64, **Salt Player for Windows 1.19.0**, the WebView2 Runtime (bundled with
Windows 11; on Windows 10 install “Microsoft Edge WebView2 Runtime”), and **.NET Framework 4.8**
(built into Windows 10 1903+). The full dependency matrix, exit codes and crash troubleshooting are
in [docs/runtime-requirements.md](docs/runtime-requirements.md).

1. Download `spw-folia-0.2.1.spmod` (Windows x64) from
   [Releases](https://github.com/azkbzxf/spw-folia/releases).
2. In SPW: **Settings → Plugins / Workshop → Import plugin**, pick the `.spmod`, enable it, and grant
   the **class-transform** ("hook") permission when asked (the More-menu hook needs it).
3. Restart SPW if the plugin manager asks you to.
4. Play a track, open the mini-player's **More** (…) menu → **Folia**.

The first run opens the Folia settings window; later runs go straight to the visualizer (⚙ top right
opens settings; ESC closes settings first, then the window). Settings are stored in SPW's plugin data
directory.

## Build from source

Toolchain: JDK 25, Gradle 9.8 (wrapper included), Kotlin 2.4.20, Node 24 + pnpm (settings UI) and the
bundled Windows `csc.exe` (.NET Framework 4.8, for the native helper). No .NET SDK, no Android SDK.

```bat
:: 1) plugin (Kotlin, official SPW creative-workshop Gradle plugin)
cd spw-folia
gradlew.bat plugin          :: -> build/libs/plugin-dev.spw.folia-0.2.1.spmod

:: 2) native helper (C# + WebView2)
cd ..\poc\webview\host
bash build.sh               :: -> build/spw-folia-host.exe (+ WebView2 dlls)

:: 3) settings UI (React)
cd ..\..\settings-ui
pnpm install && pnpm build  :: -> dist/settings-ui.js

:: 4) assemble the distributable .spmod (plugin classes + staged web bundle + native helper + licenses)
bash packaging/build-package.sh     :: stages packaging/{web,native,licenses} + SHA256SUMS
python packaging/tools/assemble-release.py ^
    --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.2.1.spmod ^
    --staging packaging --out dist/release --name spw-folia-0.2.1.spmod
```

The full packaging pipeline, payload inventory, size budget and release checklist are in
[docs/release.md](docs/release.md).

## Project layout

```
spw-folia/       Kotlin plugin (hook, playback bridge, timeline, config, helper management)
poc/webview/     native helper sources (C# WinForms + WebView2) and the dev server/driver
poc/settings-ui/ Folia settings window (React island reusing Folia components)
poc/audio/       WASAPI loopback analyzer (C#) + timeline notes
packaging/       staged web bundle + native payload + licenses + release docs
docs/            architecture, protocol, host app, hook target, Folia spec, licensing
docs/archive/    historical release notes, verification reports and acceptance evidence
research/        Folia style/settings research notes (AGPL; reference assets not committed)
```

Docs index: [docs/architecture.md](docs/architecture.md) ·
[docs/protocol.md](docs/protocol.md) · [docs/host-app.md](docs/host-app.md) ·
[docs/audio-timeline.md](docs/audio-timeline.md) ·
[docs/settings-ui-impl.md](docs/settings-ui-impl.md) ·
[docs/live-transparency.md](docs/live-transparency.md) ·
[docs/folia-spec/](docs/folia-spec/) · [docs/licensing.md](docs/licensing.md).

## Architecture (short version)

```
SPW (JVM)                                    spw-folia-host.exe (C#/WebView2)
┌──────────────────────────┐  stdin/stdout   ┌───────────────────────────────────┐
│ spw-folia plugin         │  JSON-lines     │ borderless fullscreen window      │
│  MenuHook (More → Folia) │ ──────────────▶ │  Folia OBS bundle (React)         │
│  PlaybackBridge ────────▶│ state/lyrics/   │  injected EventSource shim        │
│  Timeline (smooth)       │ track/settings  │  injected Folia settings UI       │
│  ConfigStore             │ ◀────────────── │  WASAPI loopback → audio frames   │
└──────────────────────────┘ ready/closed/…  └───────────────────────────────────┘
```

## Credits

- [Folia](https://github.com/chthollyphile/folia-major) by chthollyphile (AGPL-3.0) — the entire
  visualizer, settings UI and web bundle come from Folia's work (v0.7.21).
- [Salt Player for Windows](https://saltplayer.com/) creative-workshop plugin API by Moriafly.
- [spw-island (Dynamic Lyrics Island for SPW)](https://github.com/gaboron/spw-island) — behavioural
  reference only (GPL-3.0); no code was copied.
- Microsoft Edge WebView2 SDK, .NET Framework, Kotlin/Compose, React/Vite.

## License

AGPL-3.0-or-later. This repository contains a derivative work of Folia and is distributed in the hope
that it will be useful, but without any warranty. See [LICENSE](LICENSE),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the source-availability notes in
[docs/licensing.md](docs/licensing.md).
