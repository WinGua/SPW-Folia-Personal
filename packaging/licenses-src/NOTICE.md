# NOTICE — spw-folia

spw-folia is an unofficial, community-made workshop plugin for Salt Player for Windows (SPW).
It is not affiliated with, endorsed by, or supported by the authors of Salt Player or Folia.

## This project

- spw-folia plugin source (Kotlin), settings UI (React island), and native host helper (C#):
  Copyright (C) 2026 the spw-folia contributors — licensed **AGPL-3.0-or-later**.
- Full license text: `licenses/AGPL-3.0.txt` (GNU Affero General Public License v3).

## Folia (bundled web assets)

- The `web/` directory contains the **unmodified production web build** of Folia
  (`folia-major` 0.7.21, a React/TypeScript/Vite application) as shipped inside the installed
  Folia desktop application. It is redistributed here so the plugin can render Folia's own
  visualizers (`/obs` browser-source surface) inside a WebView2 window.
- Folia is licensed **AGPL-3.0** (see its own `LICENSE`, reproduced at `licenses/AGPL-3.0.txt`).
  Copyright belongs to the Folia authors / respective contributors.
- No Folia source files were modified. `index.html` is the only file changed (the PWA service
  worker registration tag and manifest link were removed, because the service worker is not
  shipped in this plugin). Everything else is byte-identical to the upstream build output.
- The corresponding source of the bundled web assets is the upstream Folia source at
  https://github.com/chthollyphile/folia-major, tag `v0.7.21`
  (commit `33b25ff75252435a78006af45114fdf10e64727a`), plus this repository's build/staging
  scripts (`packaging/tools/stage-web.mjs`) documenting exactly how the subset was produced from
  that build output.
- The visualizer settings UI shipped in `web/settings/` is built from this repository's source
  (`poc/settings-ui/`), reusing Folia UI components under AGPL-3.0.

## WebView2 (native host helper)

- `lib/Microsoft.Web.WebView2.Core.dll`, `lib/Microsoft.Web.WebView2.WinForms.dll` and
  `lib/WebView2Loader.dll` are redistributed from the Microsoft.Web.WebView2 NuGet package,
  **Microsoft WebView2 SDK**, see `licenses/WebView2-SDK-LICENSE.txt` and
  `licenses/WebView2-SDK-NOTICE.txt`. The WebView2 Runtime itself is a system component provided
  by Microsoft Edge WebView2 and is not redistributed with this plugin.
- The helper executable `lib/spw-folia-host.exe` additionally links only Microsoft .NET Framework
  4.8 class libraries (system components, not redistributed).

## Audio loopback analyzer (C#)

- The WASAPI loopback / FFT code compiled into `lib/spw-folia-host.exe` is
  Copyright (C) 2026 the spw-folia contributors, **MIT licensed** (see `licenses/AUDIO-MIT.txt`).
  It has no third-party audio dependencies (no NAudio, no FFTW).

## Fonts

- No font files are bundled. The bundled Folia build uses the user's system fonts and, for
  optional licensed Folia fonts, the user's own installed fonts. The plugin never redistributes
  commercial fonts.

## Privacy / network

- No telemetry. The plugin only reads playback state (title/artist/album/cover/lyrics/timing/audio)
  from the local SPW workshop API and renders it locally. In production the host window loads only
  local files through a WebView2 virtual host mapping (`https://spw-folia.local/`); no network
  requests are made by the shipped page (verified offline, see `docs/webview-spike.md`).
