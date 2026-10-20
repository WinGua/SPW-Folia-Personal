# Acceptance & QA plan (spw-folia)

Status: living document, Lead-owned. Every milestone gate needs evidence paths (logs/screenshots)
recorded here or in the milestone note. Host version pin: **SPW 1.19.0** (`workshop api 0.1.0-dev22/23`).

## Single-sentence definition of done

In SPW 1.19.0's mini-player "更多" menu there is a **Folia** item; clicking it opens a fullscreen
Folia lyric-visualizer window driven by the currently playing track (position/lyrics/translation/
cover/theme/audio), with Folia 0.7.21's 14 lyric styles (商籁 凝彩 绘光 流光 心象 云阶 浮名 倾诉 回环
莫奈 时计 群唱 镜台 静止) and a Folia-faithful settings page (tabs 歌词动画/背景/字体/字幕; 智能动感
模式; 动感效果 推镜裂光+强度; 渲染质量 纹理分辨率; 动态与构图 镜头运动强度/文字动势; style grid;
默认 reset), packaged as a distributable plugin and published on GitHub under azkbzxf with topic
`salt-player-plugins`.

## Gates

### G1 hook PoC (task-1)
- [ ] Trivial plugin builds via `gradlew.bat plugin` → `.spmod`.
- [ ] Local install recipe reproducible from docs/archive/re-host.md (unzip to plugins dir, enabled.txt,
      permissions.json pre-grant class-transform).
- [ ] SPW launches with it; `logs.txt` clean.
- [ ] 5th item "Folia" appears in mini-player 更多 menu (screenshot).
- [ ] Clicking it opens a window (any content) and dismisses the menu.
- Evidence: `spw-folia/notes/`, screenshot path, SPW logs excerpt.

### G2 integration PoC (one real style end-to-end)
- [ ] Plugin spawns `spw-folia-host.exe`, host shows Folia renderer fullscreen with real track:
      real lyrics/translation, cover-derived theme, smooth position (≥30Hz), audio bands from
      WASAPI loopback (or documented fallback).
- [ ] Menu item still works after disable/enable plugin, after track change, after SPW restart.
- [ ] Escape / plugin stop closes the window; no orphan `spw-folia-host.exe` (check Task Manager).
- [ ] SPW still closes cleanly with the plugin enabled.
- Evidence: 20-30s screen recording or 3 screenshots + host stdout log + plugin log.

### G3 settings UI parity
- [ ] Settings page visually compared side-by-side with screenshot 1 (same sections, labels,
      controls order, values formatting, 2x7 grid, 镜台).
- [ ] Every visible control changes the renderer live and survives restart (persisted via host
      ConfigManager or plugin config file).
- [ ] Defaults match Folia stores (纹理分辨率 1.5x default; screenshot value 1.00x is user state;
      智能动感模式 default off; 动感效果 defaults on, strength 1.00x max 2.00x).
- [ ] 默认 resets both UI and renderer.
- [ ] Fonts tab: lyric font scale + font choices behave; 字幕 tab: subtitle overlay toggles.
- [ ] 背景 tab: 6 modes (common/latent/monet/nomand/sora/url), default latent.
- Evidence: screenshots of each tab + Folia reference screenshots.

### G4 all 14 styles
- [ ] Each style renders correctly in the plugin window with real lyrics (screenshot per style).
- [ ] Style switching in settings is live and persisted.
- [ ] Styles that need extras (cappella avatars, monet portrait, tempera image pool, diorama
      three.js, pendolo/monet/sonnet beat models) degrade exactly like Folia when extras absent.
- [ ] Beat FX (推镜裂光 etc.) either works via injected event driver (webview-spike probe) or is
      documented as disabled with the 智能动感模式 switch honest about it.
- Evidence: `poc/webview/server/out/styles/*.png` reference set + plugin-window screenshots.

### G5 packaging / distribution
- [ ] `.spmod` contains plugin classes (+only needed lib jars), `web/` dist, `spw-folia-host.exe`,
      `WebView2Loader.dll`, licenses/NOTICE; size sane (<100MB).
- [ ] Fresh-machine simulation: copy plugin dir, pre-grant permission, launch → works (no dev-only
      paths/env; no network required).
- [ ] Uninstall/disable leaves no orphan windows or files outside plugin dir/user data.
- [ ] README: install steps, permission explanation, SPW version requirement, AGPL-3.0 notice,
      Folia attribution (upstream source link, version 0.7.21), troubleshooting (logs paths).

### G6 publish
- [ ] GitHub repo under azkbzxf, AGPL-3.0 LICENSE + NOTICE (Folia + spw-workshop-api + WebView2 SDK
      attribution), topic `salt-player-plugins` set.
- [ ] Release asset `.spmod` + sha256 + release notes (features, known limitations).
- [ ] Repo contains source for everything shipped (AGPL compliance), including the built Folia web
      assets' source pointer (upstream Folia commit) and our settings-UI source if it reuses Folia code.
- [ ] Repo does not contain host-obfuscated artifacts or credentials.

## Test matrix (manual, G2+)

| case | expected |
| --- | --- |
| no track playing | host window shows idle state w/o crash; menu item still works |
| track without lyrics | visualizer runs, no lyrics layer or fallback, no error |
| track with translation only | subtitle translation shown when enabled |
| pause / resume | animation freezes smoothly at paused position (breathing behavior per Folia) |
| seek (host seek bar) | renderer catches up within ~250ms, no line mismatch |
| track change | config/lyrics/track update, theme changes with new cover, no window flash |
| rapid style switching | no crash, GPU memory stable over 14 switches |
| 4K + 100%/150% DPI | fullscreen covers monitor, crisp text (physical pixel 1:1) |
| multi-monitor | opens on SPW's monitor (or primary), fullscreen correct |
| ESC | closes Folia window, SPW unaffected |
| plugin disabled while open | window closes, no orphan process |
| SPW exit while open | helper exits, no orphan process |
| long run 30min | no memory growth beyond threshold, no debugger errors |
| volume 0 / muted | loopback gives zero-ish signal; renderer behaves like Folia silence |

## Automated checks
- `gradlew.bat plugin` clean build (zero warnings preferred) + `.spmod` structure test script.
- Kotlin unit tests: `PlaybackTimeline` (interpolation, seek ack, pause freeze, rate), lyric mapping,
  config store serialization.
- JS: `npm run build` for web dist; protocol round-trip test (node harness) for settings UI ↔ shim.
- C#: `spw-folia-host.exe --selftest` (headless: shim injected, clock advances, exits 0) for CI/local.
- Optional golden-image comparison for renderer: same config in browser vs host, tolerance documented.

## Known risks to record honestly in README
- Host internal names are obfuscated per SPW release; pinned to 1.19.0, version guard on start.
- WebView2 runtime required (Evergreen, Win10/11 normally present; document winget install).
- WASAPI loopback is post-volume and doesn't capture ASIO/exclusive modes; beat FX may be weaker
  than Folia desktop at low volume.
- Beat-analysis models from Folia desktop (WebGPU) not shipped; 智能动感 mode limited to documented
  behavior.
