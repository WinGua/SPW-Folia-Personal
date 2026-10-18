# THIRD-PARTY COMPONENTS — spw-folia

Bundled in the plugin distribution:

| component | version | license | where | notes |
| --- | --- | --- | --- | --- |
| Folia web build (`folia-major`) | 0.7.21 | AGPL-3.0 | `web/**` (96 files, ~7.9 MB) | unmodified production build except removed PWA tags in `index.html` |
| Folia visualizer styles (15 registered styles) | 0.7.21 | AGPL-3.0 | `web/assets/Visualizer*.js` | rendered through Folia's own `/obs` browser-source surface |
| spw-folia settings UI | this repo | AGPL-3.0 | `web/settings/**` | React island; reuses Folia components |
| spw-folia native host | this repo | AGPL-3.0 | `lib/spw-folia-host.exe` | C#, .NET Framework 4.8 |
| WASAPI loopback analyzer | this repo | MIT | compiled into host exe | original clean-room C#, no NAudio |
| Microsoft WebView2 SDK | NuGet `Microsoft.Web.WebView2` (pinned in `docs/host-app.md`) | Microsoft WebView2 SDK license | `lib/Microsoft.Web.WebView2.Core.dll`, `lib/Microsoft.Web.WebView2.WinForms.dll`, `lib/WebView2Loader.dll` | see `licenses/WebView2-SDK-LICENSE.txt`, `notices/WebView2-SDK-NOTICE.txt` |
| Microsoft .NET Framework 4.8 | system | Microsoft EULA | not redistributed | required on the machine (present on Windows 11) |
| Microsoft Edge WebView2 Runtime | system | Microsoft EULA | not redistributed | system component, required at runtime |

Not bundled (build-time or host-provided only):

| component | license | notes |
| --- | --- | --- |
| SPW Workshop API / plugin SDK (`com.xuncorp.spw.workshop`) | see SPW project | `compileOnly`, provided by Salt Player at runtime |
| PF4J | Apache-2.0 | provided by SPW host |
| Node/pnpm/Python toolchain | their licenses | build only, never shipped |
| Folia AI/beat model weights (`beat_this-wgsl.bin`, `htdemucs-wgsl.bin`) | Folia AGPL distribution | **not shipped**; live in the Folia desktop install only, and smart-beat FX is out of scope for v1 |
| Fonts | — | no font files bundled; system fonts only |

## License compatibility note

The plugin as a whole is distributed under AGPL-3.0-or-later because it embeds/links Folia
(AGPL-3.0) web assets and reuses Folia UI code. The MIT-licensed WASAPI code and the Microsoft
WebView2 SDK DLLs are compatible with that distribution (permissive licenses; the SDK DLLs are
redistributable per the Microsoft WebView2 SDK license). The full AGPL text is in
`licenses/AGPL-3.0.txt`; the Folia original `LICENSE` is identical (AGPL-3.0).
