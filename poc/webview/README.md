# poc/webview — Folia render + host spike (working demo)

Everything here exists to answer one question: **can we host Folia's own production visualizer
bundle in a native window we control?** Answer: **yes** — WebView2 helper + injected EventSource
bridge, all 15 styles, 119–120 fps, offline. Decision record: `docs/webview-spike.md`; host
implementation: `docs/host-app.md`; IPC contract: `docs/protocol.md`.

## One-command demo

```bash
cd poc/webview/host && bash build.sh
cd poc/webview/host && node driver.mjs --window 1600x900        # spawns host, streams state, screenshots, ESC
cd poc/webview/host && node driver.mjs --fullscreen --out out/fullscreen
cd poc/webview/host && node driver.mjs --window 1280x720 --out out/host-styles-run \
  --modes sonnet,tempera,lumiere,diorama,pendolo,monet,fume,cappella,partita,claddagh,cadenza,tilt,still,window,classic
```

## Layout

| path | what |
| --- | --- |
| `dist/` | `app.asar` extraction from `C:\Program Files\Folia\resources\app.asar`; web build in `dist/dist/` (read-only input copy) |
| `shared/demoData.mjs` | synthetic lyric timeline (16 s, 4 lines), theme, full `ObsBrowserSourceConfig`, audio/state frame generator |
| `server/` | Node dev server + proof probes: `server.mjs` (static + `/obs/events` SSE), `check.mjs` (browser render), `styles.mjs` (15-style sweep), `probe-offline.mjs`, `probe-beat.mjs`, `probe-beat-chain.mjs` |
| `host/` | `spw-folia-host.exe` source (C# 5 / .NET 4.8 / WinForms + WebView2), `Shim.js`, `Overlay.js`, `build.sh`, `driver.mjs` |
| `tools/` | WebView2 SDK (`Microsoft.Web.WebView2.*.dll`, `WebView2Loader.dll`) extracted from the NuGet package |
| `out` artifacts | browser screenshots (`server/out/`), host runs (`host/out/`) |

## Requirements

Windows 10/11, WebView2 Runtime (preinstalled/evergreen; 150.0.4078.83 tested), Node ≥ 20 for the
driver/dev server, .NET Framework 4.8 (in-box). No dotnet SDK, no npm install needed for the host
itself (playwright-core is needed only for the browser-side probes: `cd poc/webview/server && npm i`).

## Regenerate inputs

```bash
# web bundle from the installed Folia app (read-only; do not modify work/ inputs)
npx @electron/asar extract "C:\Program Files\Folia\resources\app.asar" poc/webview/dist
# WebView2 SDK
curl -L -o poc/webview/tools/webview2.nupkg https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2
```

The `proxy` variant of this spike used `server.mjs`; production never runs an HTTP server — the host
serves the same files through `SetVirtualHostNameToFolderMapping("spw-folia.local", …)`.
