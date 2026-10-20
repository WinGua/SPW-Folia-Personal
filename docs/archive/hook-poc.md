# SPW Folia — menu hook PoC (task-1)

Status: **COMPLETE / VERIFIED on SPW 1.19.0 (MS channel)** — 2026-10-18.

Goal proven: a Workshop plugin can inject a 5th item **Folia** into the mini-player
“更多” flyout and, on click, create a real fullscreen window **inside the SPW process**.

Evidence (all generated this session):

| Evidence | Path |
| --- | --- |
| 更多 menu open, 5th item `Folia` visible | `poc/hook/shots/menu-open.png` |
| Folia clicked → fullscreen black window opened (in SPW process) | `poc/hook/shots/menu-click-window.png` |
| Working menu screenshot (full screen, unfiltered) | `poc/hook/shots/more-after-0.png` |
| Plugin implementation | `spw-folia/src/main/kotlin/dev/spw/folia/FoliaPlugin.kt` |
| Local install script (backup + merge + restart) | `spw-folia/scripts/install-local.sh` |
| Host reverse-engineering helpers | `poc/hook/*.py` |

Plugin log (in the installed plugin dir, `spw-folia.log`):

```
[2026-10-18T22:26:30.544208] start: id=dev.spw.folia version=0.1.0 spw=1.19.0 channel=MS path=...\dev.spw.folia-0.1.0-LOCAL-ONLY
[2026-10-18T22:26:30.596130400] hookMethod installed: com.xuncorp.voxzen.workshop.hooks.ԩ$ԯ@2d5f7182
[2026-10-18T22:26:30.597133300] start done
[2026-10-18T22:31:55.070007] Folia item appended (scope=androidx.compose.ui.ჰ$Ϳ, bridge=Ϳ)
[2026-10-18T22:32:37.880452600] Folia item clicked
[2026-10-18T22:32:37.904840900] fullscreen Folia window opened (java.awt.Dimension[width=1776,height=1110])
[2026-10-18T22:32:56.250460800] window closed
```

The opened window is its own top-level window owned by the SPW process:
`hwnd=2689732 class=SunAwtFrame title=Folia rect=0,0 3200x2000` (same pid as SPW).
ESC closes it (`window closed`, `IsWindow` → false). The flyout also closes on click
(host auto-dismiss + explicit `PopupState.ԩ()`).

---

## 1. Host pin and hook targets (SPW 1.19.0)

Host app dir: `C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\`.
The full host classpath is the polyglot zip `app\ffmpeg-x64.dll`. **Always read classes
directly from that zip** (it has 1,099 case-collision groups between obfuscated names such
as `ē` U+0113 vs `Ē` U+0112 — extraction to a Windows filesystem silently corrupts classes).

Targets used by the plugin (all names are R8-obfuscated and version-specific):

| Role | JVM name | Notes |
| --- | --- | --- |
| More-menu file facade | `androidx.compose.ui.ē` (U+0113) | original `PlayerMoreMenuFlyoutKt` |
| Item-adding helper (hooked) | `ē.Ϳ` (U+037F) | static `(Track, PiscesMediaItem, PopupState, Navigator, State, MenuFlyoutScope) -> Unit`; adds the 4 host items |
| Flyout composable | `com.xuncorp.voxzen.ui.component.Ԭ.Ϳ` | `BlurPopupMenu(onDismissRequest, header, content)`; called once from `ē` |
| Menu scope interface | `androidx.compose.ui.ন` (U+09A8) | `MenuFlyoutScope`; `item(onClick, enabled, content)` |
| Scope item bridge (used) | `ন.Ϳ(ন, Function0, Function2)` | static default-arg bridge → `item(onClick, enabled = true, content)` |
| Scope impl / item list field | `androidx.compose.ui.ჰ$Ϳ` (U+10F0$U+037F), field `Ϳ` | impl adds `ऍ$Ԩ(onClick, enabled, content)` to a `List` |
| PopupState | `androidx.compose.ui.Ⴈ` (U+10A8) | `ԩ()` = dismiss/close (U+0529) |

Kanji/CJK strings are NOT stored in the host classes (Compose resources are compressed
elsewhere), so marker-string scanning is not a reliable way to find the menu; hook the
helper by JVM signature instead.

## 2. Why `appendContent` does NOT work on this host build (important)

The documented path (`HookRegistrar.appendContent(className, methodName, inClass,
parameter, scopeType, …)`) requires the host hook engine to resolve a **parameter name**
for the target call. In `WorkshopHookTargets` (obfuscated `…workshop.hooks.Ԫ`) this name
comes from the Kotlin `@Metadata` KmFunction ↔ JVM method association:

- `KmFunction.JvmMethodSignature.name` in this host still contains the **original** name
  (`BlurPopupMenu(...)`), while R8 renamed the real methods to single obfuscated chars
  (`Ϳ`, `Ԩ`, …) — the association `signature.name == method.name && signature.descriptor ==
  method.descriptor` therefore never matches.
- The class files have **no `MethodParameters` attribute**, so reflection names are `""`.

Result: parameter lookup always fails. What we observed:

- `appendContent(..., parameter = "content", …)` on the intended call sites failed with
  `java.lang.IllegalArgumentException: UI call missing or ambiguous: androidx.compose.ui.ē -> com.xuncorp.voxzen.ui.component.Ԭ.BlurPopupMenu (0 calls)`
  (the engine could not map the metadata original name to the real JVM method);
- even with the correct obfuscated JVM name the parameter list is empty
  (`names.indexOf("content") == -1`) so it would throw
  `UI parameter 'content' is missing or is not an ordinary Function1: …`.

**Conclusion:** on this R8-obfuscated build only `hookMethod` (full JVM signature, no
metadata/parameter names) is reliable. Do not spend more time on `appendContent` unless a
future SPW build ships unrenamed JVM methods or `MethodParameters`.

## 3. Working hook design

1. `hookMethod` on the non-composable helper `androidx.compose.ui.ē.Ϳ(Track,
   PiscesMediaItem, PopupState, Navigator, State, MenuFlyoutScope)` — exact full JVM
   parameter type list is required by the engine (order-sensitive `List<String>`).
2. In `MethodHook.after(call)`:
   - `scope = call.args[5]`, `popupState = call.args[2]`;
   - dedupe per popup session by the scope impl's backing `List` (`WeakHashMap`),
     because the lambda can rerun on recomposition;
   - reflectively call the static bridge `ন.Ϳ(scope, onClick, content)` with
     `content` = a `@Composable () -> Unit` compiled by the Compose compiler in the plugin
     (`BasicText("Folia")`), and `onClick` = plain `() -> Unit`.
3. `onClick`: log, best-effort dismiss the PopupState (`Ⴈ.ԩ()`), open the placeholder
   fullscreen window (Swing `JFrame`, undecorated, black, green “Folia”, ESC dispose,
   alwaysOnTop, screen-sized).
4. `stop()` unhooks and disposes the window.

Compose class identity: the plugin compiles with the **Compose compiler plugin** but all
Compose artifacts are `compileOnly`. Nothing Compose/Kotlin-stdlib is bundled into the
`.spmod` (`lib/` is empty), so the lambda uses the host's Compose runtime classes — this
is mandatory; a bundled Compose/Kotlin runtime breaks `Function2`/`Composer` identity.

## 4. Project + build

`D:\输出目录\dsh2\spw-folia` (standalone Gradle project, wrapper 9.8.0 copied from the
upstream example):

- `settings.gradle.kts`: Kotlin JVM 2.4.20, `org.jetbrains.kotlin.plugin.compose` 2.4.20,
  and a `resolutionStrategy.eachPlugin` mapping
  `com.xuncorp.spw.workshop` → `com.github.Moriafly.spw-workshop-api:spw-workshop-gradle-plugin:${version}`.
- `build.gradle.kts`: `java-library` + `kotlin.jvm` + `kotlin.plugin.compose` +
  `com.xuncorp.spw.workshop` `0.1.0-dev23`; JDK 25 toolchain, `jvmTarget = JVM_25`,
  `-Xjvm-default=all`; deps all `compileOnly` (`kotlin("stdlib")`,
  `com.github.Moriafly.spw-workshop-api:spw-workshop-api:0.1.0-dev23`,
  compose `runtime/foundation/ui-desktop:1.12.1`); `spmod { … }` block:

```kotlin
spmod {
    PluginClass = "dev.spw.folia.FoliaPlugin"
    PluginId = "dev.spw.folia"
    PluginName = "spw-folia"
    PluginDescription = "Folia fullscreen lyric mode for Salt Player for Windows"
    PluginVersion = "0.1.0"
    PluginProvider = "dsh2 team"
    PluginHasConfig = false
    PluginPermissions = listOf(PluginPermission.CLASS_TRANSFORM)
}
```

- `gradle.properties`: `org.gradle.jvmargs=-Xmx3g`,
  `org.gradle.java.installations.paths=C:/Program Files/Java/jdk-25.0.2`,
  `kotlin.stdlib.default.dependency=false`.

Build (Gradle 9.8.0 is not on PATH):

```bash
cd 'D:/输出目录/dsh2/spw-folia'
'C:/Users/24037/Downloads/gradle-9.8.0/bin/gradle.bat' plugin --console=plain
# => build/libs/plugin-dev.spw.folia-0.1.0.spmod  (~14.4 KB, classes/ only, lib/ empty)
```

Gotchas hit while setting this up:

- A global `~/.gradle/init.gradle` on this machine injects Aliyun mirrors and suppresses
  `settings.gradle.kts` repositories. Declare the needed repositories (jitpack,
  mavenCentral, google) **inside `build.gradle.kts`** as well.
- Do not use the coordinate `com.github.Moriafly/spw-workshop-api:<ver>` (root group) — it
  resolves to a 198-byte stub jar. Use the module coordinates:
  `com.github.Moriafly.spw-workshop-api:spw-workshop-api:0.1.0-dev23` and
  `…:spw-workshop-gradle-plugin:0.1.0-dev23`.
- `.spmod` layout produced by the workshop gradle plugin: `classes/` = expanded plugin jar
  (incl. `classes/META-INF/MANIFEST.MF` with `Plugin-Class/Id/Version/Provider/Name/
  Description/Has-Config/Permissions`), `lib/` = packaged runtime jars (empty here).

## 5. Install / permissions / restart loop

Directories (per user):

```
C:\Users\24037\AppData\Roaming\Salt Player for Windows\
  logs.txt                                   # host log
  workshop\plugins\enabled.txt               # CRLF list of enabled plugin ids
  workshop\plugins\permissions.json          # see schema below
  workshop\plugins\<dir>\                    # one unzipped .spmod per plugin
  workshop\data\<plugin-id>\                 # plugin data dir
```

`permissions.json` schema (verified from decompiled host `WorkshopPermissionStore`):

```json
{
  "dev.spw.folia": {
    "reviewed": ["class-transform"],
    "granted": ["class-transform"]
  }
}
```

- value = `{ reviewed: Set<permission-id>, granted: Set<permission-id> }`;
- permission ids: `key-bindings`, `library-read`, `library-write`, `class-transform`;
- `class-transform` is required for all class-transform hooks (`hookMethod`,
  `appendContent`, `replaceComposable`, …);
- `granted` must also appear in the plugin manifest `Plugin-Permissions`.

`enabled.txt` = plain lines of plugin ids, CRLF (`isPluginDisabled = !lines.contains(id)`).
Write it as bytes (`"\r\n".join(lines) + "\r\n"`); Python text-mode on Windows produces
`\r\r\n` and breaks parsing.

Install steps (automated by `spw-folia/scripts/install-local.sh [--restart]`):

1. back up `enabled.txt` + `permissions.json` to `spw-folia/notes/appdata-backup-<ts>/`;
2. extract `build/libs/plugin-dev.spw.folia-0.1.0.spmod` into
   `…\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY\` (fresh dir; `-LOCAL-ONLY` suffix is
   accepted for dev dirs);
3. merge + write `enabled.txt` and `permissions.json` entries;
4. **close SPW first** (`taskkill /IM "Salt Player for Windows.exe" /F`) — jars are locked
   while running; relaunch via
   `powershell Start-Process 'C:\Users\24037\AppData\Local\Microsoft\WindowsApps\Salt Player for Windows.exe'`.

Plugin log: `<plugin dir>\spw-folia.log`. Host hook/agent errors: `…\Salt Player for Windows\logs.txt`.

## 6. Verification procedure (menu + click)

1. Ensure a track is loaded (any track; the item appends for every zoom of the flyout).
2. Open the mini-player 更多 flyout: click the “…” (more) button on the bottom
   player bar (in a 3200×2000 fullscreen window it is at ≈ (2095, 1905) physical px).
   Host items: 播放速度 / 桌面歌词 / 歌词翻译 / 释放音频引擎, then plugin item **Folia**.
3. Click `Folia` (its content is only the small text, ≈ (2080, 1820) physical in that
   layout) → flyout closes, fullscreen black window with green “Folia” appears.
4. Press ESC → window closes.

UI automation helpers used: `spw-folia/scripts/screenshot.ps1` (DPI-aware, all monitors),
`click.ps1` (DPI-aware click), `atomic-click.ps1` (focus + click + screenshot atomically).
Run them via the pwsh tool. Coordinates are physical pixels; the machine is 3200×2000 @
180% scaling, and the SPW main frame was restored with `ShowWindow(SW_RESTORE)` +
`MoveWindow(200,200,1500,1081)` before measuring.

## 7. Known fragility / limits

- **Version pin**: every obfuscated class/method char can change between SPW releases
  (and even between channels/builds of 1.19.0). The plugin guards
  `pluginContext.spwVersion == "1.19.0"` and refuses to install the hook otherwise.
  Tooling to rediscover targets: `poc/hook/zip_analysis.py`, `find_menu_owner_variants.py`,
  `dump_pkg.py`, `dump_methods.py` (all read the host zip; do not use extracted dirs).
- The menu item needs a **popup session**: the item is appended when the host helper runs
  (on every flyout open / recomposition); dedupe prevents duplicates within a session.
  If the host ever pre-builds the menu once, the hook still runs at build time.
- Menu item styling: the PoC content is a bare `BasicText("Folia")`, so it renders as a
  plain small text row without the host's icon/padding. This is cosmetic only; the click
  area equals the text bounds (affects automation coordinates). Styling can be improved
  by drawing a padded `Row`/`Text` with host colors inside the content lambda
  (recommended for production). Host per-item row rendering (`MenuFlyoutItemCompat`) is a
  composable and cannot be invoked reflectively from plugin code.
- `scopeType` reflection: the static bridge signature/param types are stable for this
  build; if SPW changes them, the reflection in `appendFoliaItem` logs
  `appendFoliaItem error: …` and the plugin degrades gracefully (toast + log, no crash).
- UI automation on this machine is noisy — other processes/agent windows can steal the
  foreground between a focus call and a click; always combine focus+click+screenshot in
  one pwsh invocation.
- Swing window is a **placeholder only**. Production window = native helper
  `spw-folia-host.exe` (WebView2), spawned by the plugin (task-7). Keep the Swing path as
  fallback if spawning fails.

## 8. Next integration interface (task-7 seam)

Replace `FoliaPlugin.openFoliaWindow()` with helper spawning; listen to the item click
from `appendFoliaItem`’s `onClick`:

- production helper: `poc/webview/host/build/spw-folia-host.exe`
  (`--bundle <web> --settings-dir <web>/settings --settings-entry settings-ui.js`;
  protocol v1 JSON-lines over stdin/stdout, see `docs/protocol.md`);
- resolve packaged paths from `pluginContext.pluginPath` (`native/`, `web/`) first, fall
  back to repo dev paths (`poc/webview/host/build/spw-folia-host.exe`,
  `poc/webview/dist/dist`);
- process lifecycle: spawn on click, `hello`/`ready` handshake, playback `state`/`lyrics`/
  `track` streaming, opaque settings-tree persistence with debounce, treat
  `{"t":"closed"}` as “window closed, plugin stays loaded”, `quit` + kill (2 s grace) on
  `stop()`/disable; helper stderr → plugin log; no orphan processes.
- keep the current Swing window only as a loud fallback (toast + log).

## 9. Reproduce from scratch (short)

```bash
cd 'D:/输出目录/dsh2/spw-folia'
'C:/Users/24037/Downloads/gradle-9.8.0/bin/gradle.bat' plugin --console=plain
bash scripts/install-local.sh --restart      # backs up appdata files, installs, enables, grants, restarts SPW
# then: open 更多 (…) in the mini-player bar -> click Folia -> ESC to close
```

Acceptance (task-1): 5th item Folia visible in the real 更多 menu ✔
(`poc/hook/shots/menu-open.png`), click opens a fullscreen plugin-created window in the
SPW process ✔ (`poc/hook/shots/menu-click-window.png`, `SunAwtFrame` titled `Folia` in
SPW pid), ESC closes ✔ (`window closed` in log).
