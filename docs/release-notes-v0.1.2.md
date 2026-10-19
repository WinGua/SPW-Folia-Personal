# spw-folia v0.1.2 — cover colour fix, smart-beat switch removed

Patch release for [spw-folia v0.1.1](https://github.com/azkbzxf/spw-folia/releases/tag/v0.1.1).
Install the same way: SPW 设置 → 插件 → 导入插件, enable, grant **class-transform**,
restart if asked (or disable/enable the plugin).

## What's new

- **封面取色已修复 / Cover colour extraction fixed.** The plugin sends the cover as `coverDataUrl`
  but the settings page only consumed `coverUrl`, so the derived theme always stayed
  `Midnight Default`. The host now mirrors the cover under both spellings and the page falls back to
  `coverDataUrl` — the fullscreen theme, background tint and accent now follow the current track's
  album art. Verified with solid-colour covers: orange `#E85D04` → warm theme (mean RGB 165/105/66,
  R−B +99.5) vs near-black `#09090B` → neutral (71/71/72, R−B −0.9). See
  [docs/verification-v0.1.2.md](https://github.com/azkbzxf/spw-folia/blob/main/docs/verification-v0.1.2.md).
- **「智能动感模式」开关已删除 / Smart-beat switch removed.** The beat-detection models
  (`beat_this` / `htdemucs`, WebGPU) are not part of the WebView bundle and we do not ship a beat event
  stream, so the switch could never produce an effect. It is stripped from the settings page at build
  time; every other card, tab, slider and the 14-style grid is unchanged.
- **Inert controls summarised.** A code-level list of the remaining settings that have no effect in
  v0.1.2 (beat effects, romanised/duet subtitles, custom fonts/uploads, unmapped font-family fields,
  …) is documented in
  [docs/known-inert-settings.md](https://github.com/azkbzxf/spw-folia/blob/main/docs/known-inert-settings.md).
  Everything else — style selection, texture resolution, camera/text momentum, background modes,
  lyrics/subtitle scale, translation visibility — works.

## Release artifacts

| file | size | sha256 |
| --- | --- | --- |
| `spw-folia-0.1.2.spmod` | 12,450,848 B (1,938 entries) | `2dc2f46b8635bd4918f45b65e9cd36d814c876e8c9f5a7827da4d0621174a0b9` |
| `SHA256SUMS.txt` | 88 B | sha256 of the `.spmod` |

Payload: plugin `classes/` (gradle `8c6df3c4337a656f2f64cea3fcef03b587609389d75fcdf19a8e821798844155`),
complete Folia 0.7.21 OBS web bundle + settings island (no smart-beat card), native helper
`native/spw-folia-host.exe` (`fdac12775a62621bcf379df950a4f64149fe53bd2124281ce475c3ceef364a0a`,
WebView2), licenses.

## Verified

- Local host harness (`node poc/hook/verify-cover.mjs --fullscreen`): same lyrics/state with an orange
  vs near-black cover produces clearly different derived themes; settings page contains no
  「智能动感模式」 text (`smart-beat:text-absent`), 0 page errors.
- Real SPW 1.19.0: v0.1.2 plugin loaded (`start: id=dev.spw.folia version=0.1.2`), hook installed,
  menu item appended, click → fullscreen helper spawned from the installed payload
  (`native/spw-folia-host.exe`, window 3200×2000, page 1776×1110, 3 canvases, 89–120 fps),
  track payloads carry the cover (104–164 KB), cursor idle-hide active.
- Full regression list in
  [docs/verification-v0.1.2.md](https://github.com/azkbzxf/spw-folia/blob/main/docs/verification-v0.1.2.md).

## Requirements & limitations

Same as v0.1.1: Windows 10/11 x64, **Salt Player for Windows 1.19.0** (hook pinned to this host build),
WebView2 Runtime, `class-transform` permission. Smart-beat effects remain unavailable (see
[known-inert-settings.md](https://github.com/azkbzxf/spw-folia/blob/main/docs/known-inert-settings.md)).
AGPL-3.0; full source in the repository.
