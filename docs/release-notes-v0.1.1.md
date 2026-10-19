# spw-folia v0.1.1 — menu-item polish, cursor and settings fixes

Patch release for [spw-folia v0.1.0](https://github.com/azkbzxf/spw-folia/releases/tag/v0.1.0).
Install the same way: SPW 设置 → 插件 → 导入插件, enable, grant **class-transform**, restart if asked.

## What's new

- **更多 menu item now matches the host UI.** The injected **Folia** row uses SPW's own
  `MenuFlyoutItemCompat` metrics — 9.5 dp start padding, 19 dp leading icon, 10.5 dp gap, 14 sp label,
  11 dp trailing gap — with a monochrome two-sparkle Folia mark tinted `#EBEEF1`, the host menu content
  colour. Previously it was plain dark `BasicText`, visually inconsistent with
  播放速度 / 桌面歌词 / 歌词翻译 / 释放音频引擎.
- **Fullscreen cursor fixed.** v0.1.0 called `Cursor.Hide()` permanently, so the pointer vanished inside
  Folia mode and the ⚙ gear could not be clicked. v0.1.1 hides the cursor only after 2.5 s of inactivity,
  shows it again on movement, and keeps it visible while the 歌词样式 overlay is open.
- **Settings overlay reliability.** Fixed a page↔host UI-state echo loop (the overlay state event was
  re-dispatched locally and re-toggled the panel hundreds of times per second, which could leave it
  blank/flapping). The panel also scrolls correctly on short windows and reopens instantly.

## Release artifacts

| file | size | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.1.spmod` | 12,450,886 B (1,938 entries) | `9c4d206911eebc43869af2c0aae074efa8f672e081586946e022d7b4c89dac21` |
| `SHA256SUMS.txt` | 87 B | sha256 of the `.spmod` |

Payload: plugin `classes/` (gradle `838dc12b…`), complete Folia 0.7.21 OBS web bundle + settings island,
native helper `native/spw-folia-host.exe` (`d75b97cb…`, WebView2), licenses.

## Verified

- 更多 flyout → **Folia** opens the fullscreen renderer; real clock/lyrics drive the visualizer;
  ESC #1 closes settings, ESC #2 closes the window (exit 0); no orphan helper after SPW exits.
- Cursor: show on move → hide after 2.5 s idle → show on move → stays visible with settings open →
  real mouse ⚙ click opens 歌词样式 (`poc/hook/shots/cursor-gear-click-0.png`).
- All 14 styles render from the release payload with 0 page errors / 0 external network requests.

## Requirements & limitations

Same as v0.1.0: Windows 10/11 x64, **Salt Player for Windows 1.19.0** (hook pinned to this host build),
WebView2 Runtime, `class-transform` permission. Smart-beat models (`beat_this` / `htdemucs`) are not in
the web bundle, so 智能动感模式 stays a UI no-op in v1 (Folia's default is off). AGPL-3.0; full source in
the repository.
