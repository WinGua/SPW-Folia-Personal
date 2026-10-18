# spw-folia v0.1.0 — Folia lyric visualizer for Salt Player for Windows

The first release of **spw-folia**, a [Salt Player for Windows](https://saltplayer.com/) creative-workshop
plugin that brings [Folia](https://github.com/chthollyphile/folia-major)'s lyric visualization system into
SPW: a **Folia** entry in the mini-player **更多** menu opens a borderless fullscreen Folia mode, powered by
Folia 0.7.21's **own** rendering code (all 14 lyric styles) and driven by the music SPW is playing.

## Highlights

- **Real Folia renderer, not a port** — Folia 0.7.21's production OBS browser-source bundle runs in a
  WebView2 window; every style is Folia's original code (motion, glow, word timing, backgrounds, transitions).
- **All 14 lyric styles**: 商籁 · 凝彩 · 绘光 · 流光 · 心象 · 云阶 · 浮名 · 倾诉 · 回环 · 莫奈 · 时计 · 群唱 · 镜台 · 静止.
- **Folia's settings page 1:1** — 「歌词样式」 with tabs 歌词动画 / 背景 / 字体 / 字幕, live style grid, 默认 reset,
  智能动感模式, 推镜裂光 强度, 纹理分辨率, 镜头运动强度, 文字动势 and per-style tunings, reusing Folia's own React components.
- **Synced to SPW playback** — track/cover, word-level lyric timeline, translation subtitles, play/pause/seek/rate
  via a 100 ms interpolated timeline on top of SPW's playback callbacks.
- **Audio-reactive** — WASAPI system-loopback capture with Folia-compatible 1024-bin spectrum and 5-band
  gamma-mapped levels computed inside the native helper (no plugin-main-thread cost).
- **No HTTP server, no network** — the helper maps the local bundle to a virtual host; an injected shim feeds
  Folia's EventSource protocol from the plugin over stdin/stdout JSON-lines.
- **AGPL-3.0, full source in repo** — Kotlin plugin, C# helper, React settings UI, packaging and docs.

## Release artifacts

| file | size | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.0.spmod` | 12,443,495 B | `8c265dc1aca7ee5ee378b65f5b045ccba7e51536e812e399b0d9cf6bd9d46838` |
| `SHA256SUMS.txt` | 88 B | sha256 of the `.spmod` |

Payload: plugin `classes/` (gradle `81137cc9…`), complete Folia web bundle (1,872 asset files incl. every
lazy per-style chunk) + settings island, native helper `native/spw-folia-host.exe` (`aee45d4a…`, WebView2
cache-buster build) with WebView2Loader + 3 runtime DLLs, and the complete licenses tree.

## Requirements

- Windows 10/11 x64
- **Salt Player for Windows 1.19.0** (the menu hook is pinned to this host build; SPW's internal names change
  between releases)
- WebView2 Runtime (preinstalled on Windows 11; Windows 10 needs the Microsoft Edge WebView2 Runtime)
- `class-transform` (钩子) plugin permission, granted by the user on first run

## Install

1. Download **`spw-folia-0.1.0.spmod`** from the release assets.
2. Verify it against `SHA256SUMS.txt` (same release assets).
3. In SPW: **设置 → 创意工坊/插件 → 导入插件**, select the `.spmod`, enable it, and grant the
   **class-transform** permission when asked.
4. Restart SPW if prompted.
5. Play a song → mini-player **更多** (…) → **Folia**.

First run opens Folia's settings window; later opens go straight to the visualizer (gear ⚙ opens settings,
ESC closes the settings overlay first, then the fullscreen window).

## Verified

Tested against real Salt Player for Windows 1.19.0 (MS channel) on Windows 11, 3200x2000 @ 175% DPI, with the
release `.spmod` installed exactly as delivered:

- **Menu + window**: the mini-player **更多** menu shows a 5th item **Folia**; clicking it spawns the helper from
  the installed payload and opens a borderless 3200x2000 window (page 1776x1110 dpr 1, 3 canvases, 110-120 fps).
- **Real mouse/keys** (DPI-aware SendInput): hover ⚙ → click opens the 歌词样式 overlay → ← returns to the
  visualizer → ESC closes the window (`closed reason=user`, exit 0).
- **Playback**: track change and word-level lyrics stream to the renderer; seek via SPW ←/→ moves the visualizer;
  pause freezes the timeline and resume continues it.
- **All 14 styles** render from the release payload (15/15 sweep incl. lazy per-style chunks, 0 page errors,
  0 external network requests).
- **Persistence**: style + settings survive an SPW restart; disabling the plugin returns the menu to its 4 host
  items; 5 open/close cycles and killing SPW leave **no orphan helper processes**.
- **Soak**: 16-minute continuous run — helper stable 66-67.5 MB working set, heap GC sawtooth, 110-120 fps,
  no new errors or unexpected closes.
- **Release-candidate payload**: unpacked in a clean directory it spawns from relative paths and passes 19/19
  layout/protocol checks with 0 page errors.

Full evidence: `docs/acceptance-report.md`, `docs/plugin-integration.md`, `docs/release-candidate.md`,
`docs/host-app.md`, `docs/audio-timeline.md`.

## Known limitations (v1)

- **智能动感模式 (Smart Beat) beat effects have no visual effect in v1**: Folia's beat models
  (`beat_this` / `htdemucs`, ~133 MB) run in Folia's Electron main process and are not part of its web bundle.
  With smart beat off (Folia's default) every style renders identically to Folia; the switch is kept intact
  in the settings UI for parity.
- The hook targets **SPW 1.19.0** only; SPW upgrades require a plugin update.
- Windows only (WebView2 + WASAPI).
- WASAPI loopback is post-volume: very low system volume dims audio-reactive motion (explicit v2 improvement).
- Upload-type settings controls (custom font, monet portrait, cappella packs) are stubs in v1.
- Observed once (not reproduced in the 16-minute soak): WebView2's browser process exited unexpectedly right
  after spawn; the plugin logs it, cleans up, stays loaded, and the next menu click works. A helper-side
  auto-retry is planned for v2.
- The host helper writes one harmless `post-page: NullReferenceException` line to the SPW plugin log on each
  spawn (startup ordering noise; settings injection and rendering complete normally). Demoted to debug in v2.
- Automation could not select an instrumental track; the zero-lyrics render path was verified directly.

## License & credits

AGPL-3.0-or-later. This release bundles derivative work of Folia 0.7.21 by chthollyphile
(https://github.com/chthollyphile/folia-major, tag `v0.7.21`, commit `33b25ff75252435a78006af45114fdf10e64727a`),
whose complete source is available upstream. See `LICENSE`, `THIRD_PARTY_NOTICES.md` and
`docs/licensing.md` (including the source offer).
