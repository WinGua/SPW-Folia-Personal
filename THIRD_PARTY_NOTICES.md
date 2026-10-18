# Third-party notices

`spw-folia` is an AGPL-3.0-or-later work that is a derivative of **Folia**. This file lists the
third-party components shipped with, derived from, or used to build the plugin. See
[LICENSE](LICENSE) (AGPL-3.0) and [docs/licensing.md](docs/licensing.md) for details and the
source offer.

## Folia (visualizer, settings UI, web bundle)

- Upstream: https://github.com/chthollyphile/folia-major (author: chthollyphile)
- Version used: **0.7.21**
- Exact source: tag `v0.7.21` (commit `33b25ff75252435a78006af45114fdf10e64727a`) of
  https://github.com/chthollyphile/folia-major
- License: **GNU AGPL-3.0**
- What we use:
  - the production web bundle compiled from Folia 0.7.21 (the OBS browser-source surface,
    all 14 lyric styles, backgrounds, subtitle/harmony overlays, transitions) — redistributed in
    `packaging/web/` and inside the `.spmod`;
  - React components, translations (`zh-CN`), styling and store defaults reused by our settings UI
    (`poc/settings-ui/`), with minimal adapters (see `docs/settings-ui-impl.md` patch list);
  - research notes derived from Folia (`research/`; reference screenshots/assets are kept out of
    this repository, the Folia source itself is the upstream AGPL project).
- Because Folia is AGPL-3.0, the combined plugin (Kotlin plugin + C# helper + settings UI + bundled
  web assets) is distributed under AGPL-3.0 as well. Corresponding sources for everything we ship
  are in this repository; Folia's own source is available from the upstream URL above at version
  0.7.21 (see `docs/licensing.md` §Source offer).

## Salt Player for Windows workshop plugin API

- Upstream: https://github.com/Moriafly/spw-workshop-api (API `com.github.Moriafly:spw-workshop-api:0.1.0-dev22`)
- License: see upstream repository.
- Used at compile time only (`compileOnly`); the API classes are provided by Salt Player at runtime.
  The plugin targets Salt Player for Windows 1.19.0.

## spw-island (Dynamic Lyrics Island for SPW)

- Upstream: https://github.com/gaboron/spw-island
- License: **GPL-3.0**
- Used as a **behavioral reference only** (how a workshop plugin can create windows, probe playback
  internals, ship native helpers). No source code from this project is copied into spw-folia;
  our implementations are clean-room. This project is not distributed with spw-folia.

## Microsoft Edge WebView2 SDK

- Upstream: https://learn.microsoft.com/microsoft-edge/webview2/
- License: Microsoft software license terms (WebView2 SDK / redistributable).
- Shipped files in `packaging/native/`: `Microsoft.Web.WebView2.Core.dll`,
  `Microsoft.Web.WebView2.WinForms.dll`, `WebView2Loader.dll`.
- The WebView2 **Runtime** itself is not redistributed; it is installed by the user (preinstalled on
  Windows 11).

## .NET Framework 4.8

- The native helper is compiled against the in-box .NET Framework 4.8 (`csc.exe`). It links only
  framework assemblies (WinForms, System, System.Core, System.Drawing, System.Web.Extensions) which
  are covered by the .NET Framework redistribution terms; no framework binaries are shipped.

## WASAPI loopback code (this repository)

`poc/audio/native/*.cs` is our own clean-room implementation of Windows WASAPI loopback capture +
FFT (MIT-style permissive licensing inside this repository; it is combined into the AGPL-3.0 helper,
so the distributed binaries are AGPL-3.0). No third-party audio library is used.

## Kotlin / Compose / Gradle

- Kotlin, Kotlin Coroutines: Apache-2.0; Compose Multiplatform / Compose runtime and foundation:
  Apache-2.0 (host-provided at runtime; not bundled).
- Gradle wrapper: Apache-2.0.
- React 19, Vite, TypeScript, zustand, i18next, framer-motion, lucide-react, dexie, react-colorful,
  react-window: MIT (or Apache-2.0 for TypeScript); see `poc/settings-ui/package.json` and
  `pnpm-lock.yaml`.
- Fonts: Folia's font stack (serif UI fonts) uses system fonts / Noto Serif SC fallbacks; no font
  files are redistributed in this repository except MiSans-related assets where noted (SPW provides
  MiSans at runtime). If a font file is later bundled, its license must be recorded here.

## Research / reference assets

During development we used screenshots and UI assets captured from Folia 0.7.21 (AGPL-3.0) for
specification and visual comparison. Those reference captures are not redistributed in this
repository; the equivalent material is reproducible from the upstream Folia source at the tag/commit
listed above and from the bundled `web/` build inside the released `.spmod`.
