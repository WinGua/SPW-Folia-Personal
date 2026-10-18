# Licensing & attribution plan (spw-folia)

## Our license
- The plugin repo and every artifact we publish (source, `.spmod` release asset, bundled web
  assets, native helper binary) is licensed **AGPL-3.0-or-later**.
  Rationale: the plugin's visualizer is a redistribution + integration of **Folia**, which is
  AGPL-3.0 (see `work/folia/folia-major-main/LICENSE`, upstream https://github.com/…/folia —
  record the exact upstream repo URL + commit/tag 0.7.21 in NOTICE). AGPL requires derivative
  works and combined distributions to be AGPL and to offer corresponding source to network users.
- Source availability: repo contains all our source + build scripts; the Folia web bundle is built
  from an unmodified upstream Folia checkout (pin commit hash in a `FOLIA_UPSTREAM.md` note), so its
  source is upstream + our build recipe. The settings UI source is in our repo. The native helper
  C# source is in our repo. If we patched Folia source, ship those patches (`patches/`).

## Bundled components and their licenses (NOTICE file must list all)
| component | version | license | how we use it | obligations |
| --- | --- | --- | --- | --- |
| Folia (app + 14 visualizer styles + settings UI components if reused) | 0.7.21 | AGPL-3.0 | bundled `web/` production dist (unmodified), reused React components or clean-room derived UI | AGPL, source offer, copyright notice |
| NeteaseCloudMusicApi-style deps inside Folia dist (libraries already licensed inside Folia) | as shipped | mixed (MIT/Apache etc.) | transitively bundled in `web/` dist | keep Folia's bundled license reports (Folia dist contains its own attributions; copy them) |
| spw-workshop-api | 0.1.0-dev22/23 | check repo LICENSE (record) | compileOnly API only, not redistributed | none if compileOnly; attribution in docs anyway |
| PF4J | 3.12.0 | Apache-2.0 | compileOnly (host provides) | none if not redistributed |
| WebView2 SDK / WebView2Loader.dll | pinned version | Microsoft WebView2 SDK license (BSD-style for loader? verify) | redistributed loader DLL | include Microsoft license text, only redistribute allowed DLLs |
| MiSans / system fonts | n/a | OS/system fonts only; **do not bundle commercial fonts** | use system font stacks (Folia uses system + optional user fonts) | avoid redistributing fonts |
| WASAPI loopback code (our C#) | new | AGPL-3.0 | written by us (no NAudio) | AGPL |

## Credentials / privacy
- No credentials, tokens, cookies in repo or logs shipped. SPW logs may contain user paths — never
  publish user logs verbatim.
- The plugin reads only SPW's public workshop API data (track/lyrics/cover) for rendering; document
  this in README (no telemetry, no network).

## Publish checklist (G6)
- [ ] `LICENSE` = AGPL-3.0 full text at repo root.
- [ ] `NOTICE` with Folia copyright/upstream URL/version + commit, WebView2 SDK notice, any other.
- [ ] `FOLIA_UPSTREAM.md`: upstream URL, tag 0.7.21 commit hash, `pnpm build` recipe, list of
      files we changed (if any), how to reproduce `web/` dist byte-for-byte or honestly note
      "dist from upstream release build".
- [ ] README links to source, states AGPL, says plugin is unofficial community work, not affiliated
      with Salt Player/Folia authors.
- [ ] Release asset includes `LICENSE` + `NOTICE` inside the plugin dir (but plugin dir gets wiped
      on update? keep copies under `licenses/` inside `.spmod`, host keeps them).
- [ ] `sha256sum` published next to the `.spmod`.
- [ ] GitHub repo topic `salt-player-plugins`, description mentions SPW 1.19.0 + Folia mode.
- [ ] No build outputs committed except release asset; no `%APPDATA%` data, no host jars.
