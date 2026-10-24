# Third-party notices

`spw-folia` is an AGPL-3.0-or-later work derived from **Folia**. This file lists the third-party
components shipped with, derived from, or used to build the plugin. See [LICENSE](LICENSE) for the
full AGPL-3.0 text.

## Folia (visualizer, settings UI, web bundle)

- Upstream: https://github.com/chthollyphile/folia-major (author: chthollyphile)
- Version used: **0.7.21** (tag `v0.7.21`, commit `33b25ff75252435a78006af45114fdf10e64727a`)
- License: **GNU AGPL-3.0**
- What this repository uses:
  - Folia's production OBS browser-source bundle, all 14 lyric styles, backgrounds, subtitle and
    harmony overlays, transitions. The bundle is **not stored in this repository**; it is taken
    from the pinned official 0.3.1 package (`base-v0.3.1` release asset) and shipped inside the
    assembled `.spmod`.
  - The pre-built settings UI bundle from the same base package. Its source lives upstream in
    `azkbzxf/spw-folia`.
- Because Folia is AGPL-3.0, the combined plugin (Kotlin plugin + C# helper + bundled web assets)
  is distributed under AGPL-3.0 as well. Folia's own source is available at the upstream URL above
  at version 0.7.21.

## Salt Player for Windows workshop plugin API

- Upstream: https://github.com/Moriafly/spw-workshop-api
  (`com.github.Moriafly:spw-workshop-api:0.1.0-dev23`)
- License: see the upstream repository.
- Used at compile time only (`compileOnly`); the API classes are provided by Salt Player at
  runtime. The plugin targets Salt Player for Windows 1.19.0 and later.

## spw-island (Dynamic Lyrics Island for SPW)

- Upstream: https://github.com/gaboron/spw-island
- License: **GPL-3.0**
- Used as a **behavioral reference only** (how a workshop plugin creates windows, probes playback
  internals, ships native helpers). No source code from this project is copied into spw-folia; our
  implementations are clean-room. This project is not distributed with spw-folia.

## Microsoft Edge WebView2 SDK

- Upstream: https://learn.microsoft.com/microsoft-edge/webview2/
- License: Microsoft software license terms (WebView2 SDK / redistributable).
- The three SDK files (`Microsoft.Web.WebView2.Core.dll`, `Microsoft.Web.WebView2.WinForms.dll`,
  `WebView2Loader.dll`) are taken from the `native/` folder of the pinned base package and shipped
  in the assembled `.spmod` next to the helper.
- The WebView2 **Runtime** itself is not redistributed; it is installed by the user (preinstalled on
  Windows 11).

## .NET Framework 4.8

- The native helper is compiled against the in-box .NET Framework 4.8 (`csc.exe`). It links only
  framework assemblies (WinForms, System, System.Core, System.Drawing, System.Web.Extensions) which
  are covered by the .NET Framework redistribution terms; no framework binaries are shipped.

## WASAPI loopback code (this repository)

`poc/webview/host/audio/*.cs` is our own clean-room implementation of Windows WASAPI loopback
capture + FFT. No third-party audio library is used. It is combined into the AGPL-3.0 helper, so the
distributed binaries are AGPL-3.0.

## Kotlin / Compose / Gradle

- Kotlin and Compose Multiplatform (runtime/foundation): Apache-2.0. Compose is host-provided at
  runtime and not bundled.
- Gradle wrapper: Apache-2.0.
- The settings UI (React/Vite, built upstream) is shipped as a pre-built bundle from the base
  package; its dependency licenses are recorded in the upstream repository.

## Reference material

During development, screenshots and UI references from Folia 0.7.21 (AGPL-3.0) were used for
specification and visual comparison. Those captures are not redistributed in this repository; the
equivalent material is reproducible from the upstream Folia source at the tag/commit listed above.
