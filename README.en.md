# spw-folia — Folia lyric visualizer for Salt Player for Windows

Brings the [Folia](https://github.com/chthollyphile/folia-major) lyric visualizer into **Salt Player
for Windows (SPW)**: the `Folia` entry in the mini player's **More** menu opens a borderless,
fullscreen mode that runs Folia's **own** rendering code (all 14 lyric styles), driven by whatever
SPW is playing.

[![Release](https://img.shields.io/github/v/release/azkbzxf/spw-folia)](https://github.com/azkbzxf/spw-folia/releases)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-lightgrey)](#install)
[![Site](https://img.shields.io/badge/promo%20site-azkbzxf.github.io%2Fspw--folia-ffb545)](https://azkbzxf.github.io/spw-folia/)

[中文](README.md) | **English**

<p align="center"><img src="docs/images/style-lumiere.jpg" width="92%" alt="The lumiere style: golden stardust and glowing lyrics"></p>

## Highlights

- **Real Folia, not a re-implementation** — the plugin embeds Folia 0.7.21's production OBS browser
  source output, so all 14 styles are Folia's original code: motion, glow, per-character timing,
  backgrounds and transitions match Folia pixel for pixel.
- **14 styles, one click away** — Sonnet · Tempera · Lumiere · Classic · Cadenza · Partita · Fume ·
  Tilt · Claddagh · Monet · Pendolo · Cappella · Diorama · Still.
- **Settings page, 1:1 with Folia** — the "Lyric Style" window reuses Folia's own React components;
  the large preview on the left is the real renderer running frame by frame in a same-origin iframe,
  so every slider is reflected live.
- **Desktop transparency overlay** — the round button panel at the bottom right of the fullscreen
  page toggles **transparent playback page**: the window becomes genuinely transparent and leaves
  only lyrics and effects composited over the desktop or other windows — ideal for streaming or OBS
  overlays. The second row, **mouse passthrough**, lets you keep working while the lyrics stay on
  screen, and **Ctrl+Alt+B** restores opacity at any time.
- **Cover colour theming** — theme, background and accent colours derive from the current track's
  cover art and change as the song changes.
- **Perfectly in sync with the player** — per-character lyrics, translation subtitles, play / pause /
  seek / speed; optional WASAPI loopback analysis makes the visuals react to the music.
- **No network, no uploads** — there is no HTTP server and no external request; data only travels
  between the plugin and its local helper process over stdin/stdout.

## Screenshots

<p align="center">
  <img src="docs/images/fullscreen-chrome.jpg" width="49%" alt="Fullscreen playback page with the gear that opens settings">
  <img src="docs/images/settings-ui.jpg" width="49%" alt="Folia settings page with a live renderer preview">
</p>
<p align="center">
  <img src="docs/images/transparent-background.jpg" width="49%" alt="Transparent playback page: lyrics composited onto the desktop">
  <img src="docs/images/style-grid.png" width="49%" alt="All 14 lyric styles at a glance">
</p>
<div align="center"><sub>Fullscreen page · Folia settings · Transparent playback page · 14 lyric styles</sub></div>

> Want the whole tour at once? The [**promo site**](https://azkbzxf.github.io/spw-folia/) has the
> scrolling demo, every style at full size, and a
> [48-second recorded walkthrough](https://azkbzxf.github.io/spw-folia/#film) — all footage rendered
> by the plugin itself.

## Install

**Requires**: Windows 10/11 x64 · **Salt Player for Windows 1.19.0** · WebView2 Runtime (bundled on
Windows 11; install "Microsoft Edge WebView2 Runtime" on Windows 10) · .NET Framework 4.8 (bundled
since Windows 10 1903). The full dependency matrix and crash troubleshooting live in
[docs/runtime-requirements.md](docs/runtime-requirements.md).

1. Download `spw-folia-0.2.1.spmod` from [Releases](https://github.com/azkbzxf/spw-folia/releases).
2. SPW → **Settings → Plugins / Workshop → Import plugin**, pick the file and enable it. Grant the
   **class-transform** ("hook") permission when asked — the menu hook needs it.
3. Restart SPW when the plugin manager asks.
4. Play a song, open the mini player's **More** (…) menu → **Folia**.

The first run opens the Folia settings window; afterwards the visualizer opens directly (⚙ opens
settings, ESC closes settings first and then the window). Settings are stored in SPW's plugin data
directory.

<p align="center"><img src="docs/images/menu-folia.png" width="240" alt="The Folia entry in SPW's More menu"></p>

## Limitations

- **No smart-beat beat effects** — Folia's OBS interface does not expose beat events, and the beat
  model (~133 MB) lives in Folia's Electron main process, not in its web bundle. With smart beat off
  (Folia's default) every style renders exactly as it does in Folia. All inert settings controls have
  been removed; the list of what remains is in
  [docs/known-inert-settings.md](docs/known-inert-settings.md).
- **Windows only** — the helper depends on WebView2 and Windows WASAPI.
- **Pinned to Salt Player for Windows 1.19.0** — the menu hook targets that host build; on other
  versions the plugin refuses to install the hook (see [docs/hook-target.md](docs/hook-target.md)).
- Read-only with respect to your library: playback state, current track, lyrics and cover art are
  read, never written.

## Versions

Currently **v0.2.1**. The `.spmod` and its SHA-256 checksum for every release are on
[GitHub Releases](https://github.com/azkbzxf/spw-folia/releases); per-version notes and acceptance
evidence are archived in [docs/archive/](docs/archive/) rather than repeated here.

The shipped artifact has been accepted end to end on Windows 11 against a real SPW 1.19.0: menu entry
→ fullscreen rendering, 14 styles scanned (15/15 screenshots), 0 page errors, 0 external network
requests, a 16-minute soak, persisted settings and no orphaned helper processes.

## Build from source

Toolchain: JDK 25, Gradle 9.8 (wrapper included), Kotlin 2.4.20, Node 24 + pnpm (settings UI), and
the Windows-bundled `csc.exe` (.NET Framework 4.8) for the native helper. No .NET SDK and no Android
SDK required.

```bat
:: 1) Plugin (Kotlin, via the official SPW workshop Gradle plugin)
cd spw-folia
gradlew.bat plugin          :: -> build/libs/plugin-dev.spw.folia-0.2.1.spmod

:: 2) Native helper (C# + WebView2)
cd ..\poc\webview\host
bash build.sh               :: -> build/spw-folia-host.exe (+ WebView2 dlls)

:: 3) Settings UI (React)
cd ..\..\settings-ui
pnpm install && pnpm build  :: -> dist/settings-ui.js

:: 4) Assemble the distributable .spmod (plugin classes + staged web bundle + native process + licenses)
bash packaging/build-package.sh     :: stages packaging/{web,native,licenses} + SHA256SUMS
python packaging/tools/assemble-release.py ^
    --spmod spw-folia/build/libs/plugin-dev.spw.folia-0.2.1.spmod ^
    --staging packaging --out dist/release --name spw-folia-0.2.1.spmod
```

The full pipeline, payload inventory, size budget and release checklist are in
[docs/release.md](docs/release.md).

## Documentation

[Architecture](docs/architecture.md) · [Protocol](docs/protocol.md) · [Native host](docs/host-app.md) ·
[Audio & timeline](docs/audio-timeline.md) · [Settings UI](docs/settings-ui-impl.md) ·
[Transparency mechanism](docs/live-transparency.md) · [Folia spec](docs/folia-spec/) ·
[Packaging & release](docs/release.md) · [Runtime requirements](docs/runtime-requirements.md) ·
[Licensing](docs/licensing.md)

## Credits

- [Folia](https://github.com/chthollyphile/folia-major) by chthollyphile (AGPL-3.0) — the whole
  visualizer, settings UI and web bundle come from Folia's work (v0.7.21).
- The Salt Player for Windows workshop plugin API, by Moriafly.
- [spw-island (Dynamic Lyrics Island for SPW)](https://github.com/gaboron/spw-island) — used as a
  behavioural reference only (GPL-3.0); no code was copied.
- Microsoft Edge WebView2 SDK, .NET Framework, Kotlin/Compose, React/Vite.

## License

AGPL-3.0-or-later. Not affiliated with Folia or Salt Player; this repository contains a derivative
work of Folia and is distributed in the hope that it will be useful, but without any warranty. See
[LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the source-offer notes in
[docs/licensing.md](docs/licensing.md).
