# SOURCE OFFER — spw-folia

This distribution includes software licensed under the **GNU Affero General Public License v3**
(Folia web assets, and the spw-folia plugin itself). The complete corresponding source is
available as follows.

## spw-folia (plugin, settings UI, native host helper, staging scripts)

Full source code: this repository. The release artifact contains:

- `lib/spw-folia-host.exe` — native host helper, C# (.NET Framework 4.8). Source: `poc/webview/host/`.
  Build: `bash poc/webview/host/build.sh` (no SDK required; in-box `csc.exe`).
- `web/settings/` — settings UI island. Source: `poc/settings-ui/`. Build: `pnpm build`
  (Vite, React, imports Folia components from the Folia source checkout).
- Kotlin plugin (spawns the host helper, feeds playback state): `spw-folia/`.
- Packaged web subset staging: `packaging/tools/stage-web.mjs` plus the dependency report
  `poc/webview/server/out/offline-report.json`; native assembly: `packaging/build-package.sh`.

## Folia web assets (`web/`)

`web/` is the unmodified production web build of **Folia `folia-major` 0.7.21** (AGPL-3.0),
extracted from the installed Folia desktop application as distributed to end users. No Folia
source is modified. `web/index.html` had two non-functional PWA tags removed (service-worker
registration + manifest link); this one-line change is documented and reproducible.

To reproduce or modify the Folia part, obtain the upstream Folia source:
https://github.com/chthollyphile/folia-major, tag `v0.7.21`
(commit `33b25ff75252435a78006af45114fdf10e64727a`). Run its web build and stage the subset with
`node packaging/tools/stage-web.mjs` (see `docs/release.md`).

Whoever distributes this plugin (including any modified version) must keep this source offer and
must offer the Corresponding Source to users interacting with it over a network, per AGPL-3.0 §13.

## Written offer

If you received a binary release of this plugin and cannot obtain the source from the locations
above, contact the distributor of that binary and they will provide the Corresponding Source
(AGPL-3.0 §6 / §13).
