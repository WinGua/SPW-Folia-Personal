# spw-folia — Architecture v2 (FINAL, 2026-10-18)

Goal: **SPW 1.19.0 Windows workshop plugin**. Adds a **Folia** item to the mini-player 更多 menu; clicking opens a
**fullscreen Folia lyric mode** reproducing Folia's 14 lyric styles, all effects, settings UI and defaults as
faithfully as possible. Publish to GitHub (`azkbzxf/spw-folia`, topic `salt-player-plugins`) under **AGPL-3.0**
(Folia-derived work), with a `.spmod` release.

Related docs (authoritative order):
- `docs/protocol.md` — **implementation contract v1** for plugin↔host↔page (frozen; changes require Lead approval).
- `docs/archive/re-host.md` — SPW host RE facts, local plugin install/test loop, build env.
- `docs/hook-target.md` — exact SPW 1.19.0 hook target for the 更多 menu + fallbacks.
- `docs/folia-spec/README.md` (+ style-map / settings-ui / tunings / runtime-contracts / fullscreen-shell / assets) —
  Folia behavior spec extracted from source (14 styles, settings, audio scale, theme, transitions).
- Implementation docs: `docs/host-app.md`, `docs/settings-ui-impl.md`, `docs/audio-timeline.md`.
- Decision records (frozen): `docs/archive/webview-spike.md`, `docs/archive/hook-poc.md`.
- `docs/architecture.md` (this file) — how the pieces fit.

## 1. Core decisions

1. **Do not port Folia's visualizers to Kotlin.** Folia (React/TS, ~60k lines, AGPL-3.0) already ships a
   first-class **OBS browser-source surface**: `dist` mounts `ObsBrowserSourceApp` at pathname `/obs` or `?obs=1`
   (plain browser, no Electron; verified). We bundle Folia's real production dist → pixel-faithful, all 14 styles,
   backgrounds, glow words, subtitle overlay, transitions.
2. **No HTTP server, no network, no Electron.** WebView2 host maps a local folder to virtual host
   `https://spw-folia.local`; Folia's `EventSource` is replaced by an injected **Shim.js** fed by
   `window.chrome.webview` messages. This keeps the plugin small, offline, and secure.
3. **Native helper process** `spw-folia-host.exe`: C# .NET Framework 4.8 + WinForms + WebView2 (system runtime
   150.x already present) — borderless fullscreen window, WASAPI loopback audio analysis, IPC with the JVM plugin.
   Rationale: SPW is a 512 MB-heap Compose/Skia app; embedding Chromium/JCEF in-JVM is heavy/risky, while helper
   processes are the proven pattern (spw-island bundles native exes). Fallback only if WebView2 impossible: JCEF.
4. **Plugin stays thin**: it owns data (playback clock, lyrics, track/cover, settings persistence) and lifecycle;
   it never renders. The page owns settings UI + `ObsBrowserSourceConfig` building + rendering.
5. **Settings UI reuses Folia's real React components** (React island injected into the same page) per
   `docs/folia-spec/settings-ui.md` §8; fallback components are clean-room per its §7 visual specs.

## 2. Components

```
Salt Player for Windows 1.19.0 (JVM/Compose)  ── spawn ──▶  spw-folia-host.exe (per fullscreen session)
  spw-folia plugin (.spmod, PF4J, Kotlin)                    C# WinForms + WebView2
  ├─ MenuHook      appendContent on 更多 menu                ├─ fullscreen borderless window (DPI, multi-monitor)
  ├─ PlaybackBridge PlaybackExtensionPoint                   ├─ loads web/ (virtual host spw-folia.local)
  ├─ Timeline      1Hz→60Hz position interpolation           ├─ injects Shim.js → settings UI bundle → assets
  ├─ ConfigStore   settings JSON in workshop/data/<id>/      ├─ WASAPI loopback → 0..255 FFT/bands/power (~30-60Hz)
  ├─ HelperManager spawn/stdin/stdout/exit-watch             └─ stdio JSON-lines ⇄ plugin (protocol v1)
  └─ LibraryBridge cover/track metadata
                                                                    │ chrome.webview messages
                                                                    ▼
                                              WebView2 page = Folia dist (/obs) + injected scripts
                                              ├─ Shim.js: fake EventSource → clock/audio/config events
                                              ├─ settings UI (React island): 歌词样式 window, 默认, style grid 14
                                              └─ publisher.ts: settings+lyrics+track+theme → config → pushConfig()
```

## 3. Data flow (protocol v1 — see docs/protocol.md for field-level detail)

- Plugin → host: `hello`, `settings` (persisted settings seed), `state` (posMs/durationMs/playing/rate/tsMs ~100ms),
  `lyrics` (lines+cells+offset), `track` (metadata+coverDataUrl), optional `config`, `quit`.
- Host → plugin: `ready`, `closed`, `settings` (UI changed → persist), `action`, `log`.
- Host → page: `hello`, `settings`, `state→clock`, `lyrics`, `track`, `audio` (0..255 gamma scale, 1024-bin raw
  spectrum, breathing 0..40 when paused), optional `config`/`beat`.
- Page → host: `ready`, `settings`, `action`(close/reset/openDevTools), `log`.
- Page global `window.__SPW_FOLIA__`: `on/emit/getSettings/setSettings/pushConfig/requestClose/inputs`.
- **Config ownership**: settings UI/publisher builds the full Folia `ObsBrowserSourceConfig` in-page (throttled
  ≤10Hz) and calls `pushConfig`; Shim dispatches it as the config event. Host never builds config in v1.
- Audio lives entirely in the host (same process as WebView2): no IPC hop, no extra exe.

## 4. Entry / exit UX

- 更多 menu → item **Folia** (bell/graphic icon) → start helper, go fullscreen within ~1s.
- Fullscreen = Folia visualizer only (like Folia's player view), plus minimal chrome we own:
  top-right **settings gear** (opens the 歌词样式 panel), top-left **back/close** button, bottom-right
  **player background button** (v0.1.7, gold sliders icon → panel with the 播放页透明背景 switch, keeps the
  chrome visible while transparency is on); mouse hides cursor after idle, chrome auto-hides, ESC = close
  settings panel if open else close window.
- First run (no saved settings) opens the settings panel so the styles UI is immediately visible; thereafter
  remembers last panel state. Clicking menu item again while session open → no second window (bring to front).
- Close → host sends `closed`, plugin stops state feed, waits exit (kill after 2s), reopens cleanly next time.
- Crash isolation: host crash never takes SPW down; plugin logs and allows relaunch. Plugin disable/uninstall →
  `quit` + graceful kill; host never blocks file deletion (user-data in `%LOCALAPPDATA%\spw-folia`).

## 5. Packaging

- Plugin project `spw-folia/` (Gradle 9.8, JDK 25, Kotlin 2.4.20, Compose compiler plugin, official
  `com.xuncorp.spw.workshop` 0.1.0-dev23 from JitPack, `spmod {}` metadata, permission `CLASS_TRANSFORM`).
- `.spmod` = zip payload `classes/` (plugin jar), `lib/` (runtime deps), `web/` (Folia dist subset + Shim.js +
  settings UI dist + fonts), `native/` (`spw-folia-host.exe`, `WebView2Loader.dll`), `licenses/` (Folia
  AGPL-3.0 + NOTICE + third-party licenses).
- Artifact name `plugin-<id>-<version>.spmod` (official gradle plugin produces classes/+lib/; extra `web/`,
  `native/`, `licenses/` entries are added by a custom Zip task or post-processing — see task notes).
- Plugin runs the helper **in place** from its install dir (no extraction; `%APPDATA%` is writable); WebView2
  user-data → `%LOCALAPPDATA%\spw-folia\webview`.
- Local test loop: unzip `.spmod` → `%APPDATA%\Salt Player for Windows\workshop\plugins\dev.spw.folia-<ver>-LOCAL-ONLY\`,
  append `dev.spw.folia` to `enabled.txt`, pre-grant `{"dev.spw.folia":{"reviewed":["class-transform"],"granted":["class-transform"]}}`
  in `permissions.json`, restart SPW, check `logs.txt`.
- Version guard: hook targets are SPW-1.19.0-specific (`docs/hook-target.md`); on startup verify target classes
  exist, else toast/log and no-op gracefully.

## 6. Fidelity requirements (from Folia spec)

- 14 styles + order/names: 商籁 sonnet、凝彩 tempera、绘光 lumiere、流光 classic、心象 cadenza、云阶 partita、
  浮名 fume、倾诉 tilt、回环 claddagh、莫奈 monet、时计 pendolo、群唱 cappella、镜台 diorama、静止 still.
- Settings window 1:1 with screenshot 1 (tabs 歌词动画/背景/字体/字幕, 默认, 智能动感模式, 动感效果 推镜裂光+强度,
  渲染质量 纹理分辨率+GPU notice, 动态与构图 镜头运动强度/文字动势, 样式 14 grid, per-style tuning panels).
- Audio scale **0..255 with gamma**, breathing when paused, `beatImpact/downbeatImpact` only animate when we can
  inject them (webview-spike probing); otherwise sliders stored but animation stays static (documented).
- Defaults = Folia store defaults (e.g. 智能动感 off in code, 纹理分辨率 1.5; screenshot's 1.00x is a user state).
- Style switching uses Folia's softFocus/layer transition; backgrounds 6 modes (default latent).

## 7. Status / milestones

- M1 spikes: hook target decoded + PoC in progress (task-1); Folia renderer in WebView2 verified, 120 fps (task-3);
  spec docs done (task-2); audio/timeline in progress (task-4).
- M2 integration: menu item + host process + first style end-to-end inside SPW.
- M3 fidelity: all 14 styles + settings UI + persistence + real lyrics/clock.
- M4 hardening: packaging, install/uninstall, state restore, version guard, perf (1080p60), docs (zh/en), LICENSE.
- M5 publish: GitHub repo + topic + release `.spmod` + install guide.

## 8. Risks

- **Menu hook stability**: appendContent relies on obfuscated names/param names; pinned to SPW 1.19.0; runtime
  validation + clear error. Fallback: hook `ē.Ϳ(...)` item-adding helper (hookMethod) or (last resort) a
  key-binding-opened window.
- **Dist self-containment**: Folia dist may reference CDN fonts/assets — bundle locally, verify offline (spike).
- **WebView2 availability**: system runtime 150.x present; loader dll bundled; fallback message if missing.
- **Beat FX**: requires sensor model or injected module MVs; degrade gracefully.
- **Audio loopback**: exclusive-mode/ASIO output may yield silence → host falls back to static/breathing values.
- **Obfuscation drift**: future SPW versions break hooks → version pin + graceful refusal.
