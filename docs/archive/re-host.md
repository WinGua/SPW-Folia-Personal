# SPW 1.19.0 host reverse-engineering facts (for SPW-Folia plugin)

All verified on 2026-10-18 by Lead. Workspace root: `D:\输出目录\dsh2`.

## Host install / launch / data

- App dir: `C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\`
  - `ffmpeg-x64.dll` = 110,379,732-byte POLYGLOT ZIP holding the whole app classpath (42,402 entries; main class `MainKt`). Read/extract it with **Python `zipfile`** (plain `unzip` fails; only 1 entry extracts).
  - `voxzen.aot` (JDK-25 AOT cache), `skiko-windows-x64.dll`, `icudtl.dat`, `resources/`.
  - `Salt Player for Windows.cfg`: `app.classpath=$APPDIR\ffmpeg-x64.dll`, `-Djdk.attach.allowAttachSelf=true`, `-Dskiko.library.path=$APPDIR`, `-Xmx512M`.
- Launch: `C:\Users\24037\AppData\Local\Microsoft\WindowsApps\Salt Player for Windows.exe` (MSIX alias; GUI app).
- User data: `C:\Users\24037\AppData\Roaming\Salt Player for Windows\`
  - `logs.txt` ← host log; **errors from plugin loading/hooks go here** (append; check tail).
  - `workshop/plugins/` — each plugin is an unzipped dir, observed names: `SPW-Tag-Workbench-1.2.0-with-MiSans`, `dynamic-lyrics-island-for-spw-0.9.0-windows-x64`, `spw-island-0.12.1-windows-x64`; plus the original `.zip` files alongside.
  - `workshop/plugins/enabled.txt` — CRLF-separated list of enabled plugin IDs, e.g. `com.smallsinger.spw.tags`.
  - `workshop/plugins/permissions.json` — currently `{}` (map plugin-id -> granted permission list; CLASS_TRANSFORM needed for hooks; exact schema to be confirmed by experiment).
  - `workshop/data/<plugin-id>/` — per-plugin data/config dirs (e.g. `island.json`).
  - `workshop/data/agent/spw-workshop-agent.jar` — Java agent (`Agent-Class: com.xuncorp.voxzen.workshop.hooks.agent.WorkshopAgent`, `Can-Retransform-Classes: true`); decompiles to an object storing `Instrumentation`. Decompiled copy at `work/host/agent/`.
  - Previous log evidence: a local dev plugin `cdl-for-spw-0.1.0-dev-LOCAL-ONLY` (id `dev.cdl.spw`) — dir suffix `-LOCAL-ONLY` appears acceptable for local plugins.
- UI strings live in Compose resources inside the jar: `composeResources/voxzen.composeapp.generated.resources/values-zh/strings.commonMain.cvr`; format `version:0` then `string|key|BASE64(utf8)`. Menu keys confirmed: `playback_speed`, `desktop_lyrics`, `lyrics_translation`, `release_audio_engine`. Decoded 791 zh strings: `work/host/zh_strings.json`.

## Target menu (mini-player "更多") — decompiled truth

Mapped via **Kotlin SMAP attributes** (17,661 classes carry original source names; map at `work/host/smap.json`).

- More-menu screen composable: class `androidx/compose/ui/ē` = original `com/xuncorp/voxzen/ui/player/popup/PlayerMoreMenuFlyoutKt`.
  - JVM method `Ϳ(Lcom/moriafly/salt/ui/popup/PopupState;Landroidx/compose/runtime/Composer;I)V` = `PlayerMoreMenuFlyout(state: PopupState)`; only executes when `state.isOpen()`.
  - It calls `Ԭ.Ϳ(onDismiss, title, content, Composer, int, int)` where
    - callee class `com/xuncorp/voxzen/ui/component/Ԭ` = original `.../ui/component/Blur.kt` (Voxzen's Blur-kit wrappers)
    - JVM descriptor `(Lkotlin/jvm/functions/Function0;Lkotlin/jvm/functions/Function2;Lkotlin/jvm/functions/Function1;Landroidx/compose/runtime/Composer;II)V`
    - business params: `Function0` = onDismissRequest, `Function2` = title (@Composable), `Function1` = content builder `MenuFlyoutScope.() -> Unit`.
  - The content builder lambda (an inner class of ē) calls host helper `ē.Ϳ(Track, PiscesMediaItem, Ⴈ, Navigator, State, ন)` which adds 4 items via the scope: 播放速度 / 桌面歌词 / 歌词翻译 / 释放音频引擎 (labels from string resources `ౠ.*`, `ໝ.*`).
  - Item API (library `com.xuncorp.spc:spc-ui`, metadata retained in class files!):
    - scope interface: JVM class `androidx/compose/ui/ন` = `com.xuncorp.spc.ui.component.MenuFlyoutScope` (obfuscated at runtime).
    - item file class: JVM `androidx/compose/ui/ম` = `MenuFlyoutItem.kt`; functions (Kotlin metadata d2 gives original names):
      `MenuFlyoutItem(scope, onClick: () -> Unit, text: String, iconPainter: Painter?, iconColor: Color, enabled: Boolean)`,
      `MenuFlyoutItemCheck(scope, onChange: (Boolean) -> Unit, state: Boolean, text: String, enabled: Boolean)`,
      `MenuFlyoutItemDivider(scope)`.
    - the exact `scope.item(...)` JVM method used by host: name `Ϳ`, descriptor `(Landroidx/compose/ui/ন;Lkotlin/jvm/functions/Function0;Lkotlin/jvm/functions/Function2;)V` (Receiver is the scope in `invokeinterface`; args = onClick, @Composable content).
- Decompiled artifacts on disk:
  - `work/host/dec_more/androidx/compose/ui/ē.kt` (PlayerMoreMenuFlyout; 249 lines; menu item wiring at lines 231–244; item lambdas at 115–149; icon/label composables 151–229).
  - `work/host/dec_scope/com/xuncorp/voxzen/ui/component/Ԭ.kt` (Blur.kt; 1533 lines; the `(Function0,Function2,Function1)` overload at line 647; `BlurMenuFlyout` trace at Blur.kt:221).
  - `work/host/dec_scope/androidx/compose/ui/ন.kt`, `ম.kt`, `ۏ.kt`, `Ⴏ.kt`; `work/host/dec_menu/*` (MenuFlyout*.kt impls from spc/compose-fluent).
  - Metadata dumps: `/tmp/Ԭ_v.txt`, `/tmp/ন_v.txt`, `/tmp/e_v.txt` (javap -v -p with `-J-Dstdout.encoding=UTF-8`). Regenerate any time with
    `javap -J-Dstdout.encoding=UTF-8 -v -p <classdir>/<Class>.class`.

### Hook approach options (in order of preference)

1. **`appendContent`** (sanctioned): `className="com.xuncorp.voxzen.ui.component.Ԭ"`, `methodName="Ϳ"`, `parameterTypes=[kotlin.jvm.functions.Function0, kotlin.jvm.functions.Function2, kotlin.jvm.functions.Function1]`, `inClass="androidx.compose.ui.ē"`, `parameter="content"` (name TBD), `scopeType=<runtime class>` (must equal actual scope class: `Class.forName("androidx.compose.ui.ন")` for 1.19.0), content hook = `ContentHook<S>` whose `buildContent(scope, call)` reflectively invokes the scope's `item` method to add our "Folia" entry (label = Chinese "Folia"? user expects an entry; use text "Folia" or "Folia 歌词模式" — decide later).
   - Unknown: how host resolves `parameter` name (no MethodParameters attribute; no kotlinx-metadata lib in jar). Test empirically; if name resolution fails try other spellings or find host engine behavior in `com/xuncorp/voxzen/workshop/hooks/` classes (`WorkshopHookRegistrar`, `WorkshopUiHookTransformer`, `WorkshopHookTargets`, `WorkshopMethodTransformer` — readable class names; decompile with vineflower).
2. **`hookMethod` on host helper** `androidx/compose/ui/ē`.`Ϳ` with parameterTypes `[com.xuncorp.voxzen.data.entity.Track, com.xuncorp.pisces.PiscesMediaItem, <Ⴈ>, com.xuncorp...Navigator, kotlinx.coroutines.flow.State, <ন>]`: after-callback gets `args[5]` = live `MenuFlyoutScope`, then reflectively add item. Check whether helper survived R8 (javap the class).
3. Worst case: rebuild the whole more-menu with `replaceComposable`/`afterComposable` — not viable directly (can't call a @Composable via reflection).

### Requirements for the item click

When "Folia" is clicked: dismiss popup (`scope`-independent) and open **our own fullscreen window** (plugin-created; island plugin proves plugins may create their own windows, incl. native/overlay via JNA). Window content/plan: embedded Chromium-class webview rendering a Folia-derived bundle (see `docs/architecture.md`), audio/playback driven through a JS bridge.

## Host playback internals (for smooth timeline / audio)

Installed plugin `dynamic-lyrics-island-for-spw` (GPL-3.0) source extracted at `/tmp/isl`; it probes host services via reflection:
`com.xuncorp.voxzen.service.PlaybackService`, `PlaybackController`, `PlaybackMonitor`, `com.xuncorp.voxzen.data.entity.Track`; filters class names starting `com.xuncorp.voxzen` / `com.xuncorp.spw`. Use it as reference for smooth position (Workshop API `onPositionUpdated` is only 1 Hz) and for WASAPI-loopback spectrum helper (`spw-spectrum.exe`, built from C# with `csc.exe`; `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` exists; no dotnet SDK installed).

## Build environment

- JDK 25: `C:\Program Files\Java\jdk-25.0.2` (PATH `java` is an Oracle launcher wrapper; `javap` is NOT on PATH — use full path above).
- Gradle 9.8.0 extracted: `C:\Users\24037\Downloads\gradle-9.8.0\bin\gradle.bat` (no `gradle` on PATH).
- Network OK: JitPack (spw api/gradle plugin), Maven Central, Google Maven, GitHub (`gh` authed as **azkbzxf**).
- Official plugin build (from `work/spw-api/spw-workshop-api-main`, docs at `work/docs/*.html` and https://saltplayer.com/workshop/getting-started):
  - plugins: `kotlin("jvm") version "2.4.20"`, `org.jetbrains.kotlin.plugin.compose` 2.4.20, `org.jetbrains.compose` (host uses Compose Multiplatform 1.12.x, salt-ui 3.0.0-beta02), `java-library`, `kotlin("kapt")`, `id("com.xuncorp.spw.workshop") version "0.1.0-dev22"`.
  - `settings.gradle.kts` `pluginManagement { repositories { gradlePluginPortal(); maven("https://jitpack.io"); mavenCentral(); google() }; resolutionStrategy { eachPlugin { if (requested.id.id == "com.xuncorp.spw.workshop") useModule("com.github.Moriafly.spw-workshop-api:spw-workshop-gradle-plugin:${requested.version}") } } }`
  - deps: `compileOnly(kotlin stdlib)`, `compileOnly("com.github.Moriafly.spw-workshop-api:spw-workshop-api:0.1.0-dev22")`, `kapt("...spw-workshop-api:0.1.0-dev22")`; other runtime deps with `implementation` are packaged.
  - `spmod { PluginClass; PluginId; PluginVersion; PluginProvider; PluginName; PluginDescription; PluginOpenSourceUrl; PluginHasConfig; PluginPermissions = listOf(PluginPermission.CLASS_TRANSFORM) }`
  - `gradlew.bat plugin` -> `build/libs/plugin-<id>-<version>.spmod`.
- Reference plugin build (spw-island, /tmp/isl): Kotlin 2.3.0 + compose 1.12.0, JVM toolchain 21, compileOnly workshop api dev20, custom `Zip` task producing `spw-island-<ver>-windows-x64.zip` with `classes/` (unzipped plugin jar) + `lib/*.jar` + `META-INF` + `source/`; plugin jar manifest carries `Plugin-Class/Plugin-Id/Plugin-Name/Plugin-Version/Plugin-Provider/Plugin-Has-Config/Plugin-Open-Source-Url`. So plain PF4J zip layout works too if the official `plugin` task misbehaves.

## Screenshots / verification

- Capture screen from `pwsh` (FullLanguage): Add-Type System.Windows.Forms + System.Drawing, `[System.Windows.Forms.Screen]::PrimaryScreen.Bounds`, `Graphics.CopyFromScreen` -> PNG -> view with `read_image`.
- `read_image` accepts local PNG. Use it to verify the injected menu entry and the fullscreen Folia mode.

## Local install & permission pre-grant (verified from host runtime 1.19.0)

Host workshop runtime decompiled into `work/host/dec_ws/com/xuncorp/voxzen/workshop/`
(original names via SMAP: `WorkshopPermissionStore.kt`, `VoxzenPluginManager.kt`,
`WorkshopPluginRepository.kt`, `PluginManifestReader.kt`, `PluginPackageArchive.kt`,
`hooks/WorkshopHookRegistrar.kt`, `hooks/WorkshopHookTargets.kt`, ...).

- **`permissions.json` schema** (from `WorkshopPermissionStore` + `Decision$$serializer`, strings
  "reviewed"/"granted" verified in bytecode):
  ```json
  {"<pluginId>": {"reviewed": ["class-transform"], "granted": ["class-transform"]}}
  ```
  Path: `<first pluginsRoot>/permissions.json` = `%APPDATA%\Salt Player for Windows\workshop\plugins\permissions.json`.
  Both sets must contain the permission id or the host considers it un-granted/needs review
  (store API: `requiresReview(pluginId, declared)` returns `!reviewedGranted.containsAll(declared)`).
  Granted set must be a subset of the manifest's `Plugin-Permissions`, else
  `IllegalArgumentException("Cannot grant undeclared plugin permissions")`.
  Permission ids: `key-bindings`, `library-read`, `library-write`, `class-transform`.
- **`enabled.txt`**: the host's PF4J `PluginStatusProvider` (`ׯ.kt` = `…PluginStatusProvider.kt`) is a
  plain line list of plugin IDs at `<pluginsRoot>/enabled.txt`; `isPluginDisabled(id) = !lines.contains(id)`.
  Append your plugin id as a new line (CRLF or LF both fine) to enable it.
- **Plugin discovery**: PF4J `DefaultPluginManager` with a custom `DefaultPluginRepository`; the host scans
  `workshop/plugins/` for unzipped plugin directories. Directory name is not semantically important
  (observed convention `<PluginName>-<Version>-<platform>`, local dev dirs may end with `-LOCAL-ONLY`).
  Valid layout = a PF4J plugin dir: `classes/META-INF/MANIFEST.MF` (with `Plugin-Id` etc.) + class files,
  plus optional `lib/*.jar`. This is exactly what `.spmod` contains (`classes/` expanded jar + `lib/` runtime jars),
  so local test = unzip `plugin-<id>-<version>.spmod` into `workshop/plugins/<any-name>/`.
- **Plugin permission UI note**: if a plugin declares permissions that are not pre-granted, the host will
  show its own permission dialog; for automated local tests pre-write `permissions.json` before launching SPW,
  and delete the plugin data dir (`workshop/data/<pluginId>/`) when you want a clean first-run state.
