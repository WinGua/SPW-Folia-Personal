# Hook target: inject "Folia" item into mini-player 更多 menu (SPW 1.19.0+)

Status: **version-independent since v0.3.1** (2026-10-23). The obfuscated names below are *data*, not
code: `HostTargets` resolves them per host build and caches the result, so a new SPW patch release no
longer needs a plugin release.

The working approach is **`hookMethod` on the host's item-adding helper**; the originally planned
`appendContent` is **impossible on this R8-obfuscated host build** (root cause below). Implemented
in `spw-folia/src/main/kotlin/dev/spw/folia/FoliaPlugin.kt` (owner: hook-poc). Deep background:
`docs/archive/re-host.md`.

## Resolution layers (v0.3.1+)

SPW is R8-obfuscated, so **every release renames the classes and methods we touch** — 1.19.2 kept the
structure but renamed `ē`/`ন`/`Ⴈ` to `घ`/`Ը`/`ะ`. The plugin therefore resolves its targets at
runtime (`spw-folia/src/main/kotlin/dev/spw/folia/HostTargets.kt`):

| layer | when | cost |
| --- | --- | --- |
| `host-targets.json` cache (keyed by `spwVersion`) | every start after the first success on that build | ~0 |
| built-in profile (`PROFILES`: 1.19.2, 1.19.0) | known builds | ~0 |
| structural classpath scan | unknown build — background thread, does not stall start-up | ~0.5–2 s once |

Every layer is **validated by reflection** before use (helper signature + scope bridge + palette
getter), so a stale name is never trusted. The scan finds the helper by shape —
`(Track, PiscesMediaItem, <PopupState>, Navigator, State, <MenuFlyoutScope>)` is unique in the host
and three of those types are not obfuscated — then splits the two `androidx.compose.ui.*` parameters
by looking for the interface that carries the Kotlin default-argument item bridge.

Two host facts the scan works around:

- **The jar's zip entry names cannot be trusted.** Several entries are stored under a name that
  differs from the class they contain (`androidx/compose/ui/Ϡ.class` holds `…/ϡ`), so candidates are
  identified by the `this_class` parsed out of the class file, never by the entry path.
- **`java.class.path` is a single polyglot jar** (`app/ffmpeg-x64.dll`), readable with `ZipFile`.

### Known profiles

| build | menu facade | helper | MenuFlyoutScope (bridge) | PopupState (dismiss) |
| --- | --- | --- | --- | --- |
| 1.19.0 | `androidx.compose.ui.ē` (U+0113) | `Ϳ` | `androidx.compose.ui.ন` (U+09A8) / `Ϳ` | `androidx.compose.ui.Ⴈ` (U+10A8) / `ԩ` |
| 1.19.2 | `androidx.compose.ui.घ` (U+0918) | `Ϳ` | `androidx.compose.ui.Ը` (U+0538) / `Ϳ` | `androidx.compose.ui.ะ` (U+0E30) / `ԩ` |

Verified on 1.19.2 (Steam build) from `…/Salt Player for Windows/app/ffmpeg-x64.dll`:
`घ.Ϳ(Track, PiscesMediaItem, ะ, Navigator, State, Ը)Unit`, scope impl `ʎ$Ϳ` (items list field `Ϳ`),
flyout content colour still `ʰ.Ԩ(composer).Ԩ()`. The **playback-controls** reflection
(`FoliaPlaybackControls.kt`) needed no change — `PlaybackQueueState`'s field order and
`com.xuncorp.spc.core.queue.Ϳ` survived the rename.

Log lines to look for in `spw-folia.log`:

```
host menu profile:1.19.2: androidx.compose.ui.घ.Ϳ(Track, PiscesMediaItem, ะ, Navigator, State, Ը)
hookMethod installed: … (profile:1.19.2)
Folia item appended (scope=androidx.compose.ui.ʎ$Ϳ, bridge=Ϳ)
```

`unsupported SPW version …` appears only below 1.19.0. An unknown newer build logs
`scanning the host classpath in the background`, then either the resolved target or
`could not locate the 更多 flyout`.

## What the menu is

The 更多 button in the mini player opens a `PopupState` flyout rendered by `PlayerMoreMenuFlyout`
(original file: `com/xuncorp/voxzen/ui/player/popup/PlayerMoreMenuFlyout.kt`, runtime file facade
`androidx.compose.ui.ē`, ē = U+0113). It shows 4 items: 播放速度 / 桌面歌词 / 歌词翻译(checked) /
释放音频引擎 (screenshot 2).

Decompiled: `work/host/dec_more/androidx/compose/ui/ē.kt`. Its composable (line ~96) calls the
Blur.kt file facade `com.xuncorp.voxzen.ui.component.Ԭ` (Ԭ = U+052C):

```
BlurPopupMenu(onDismissRequest /*Function0*/, header /*Function2?*/, content /*MenuFlyoutScope.()->Unit*/)
```

The 4 items are appended by a **private static helper in the same class** (the content-builder
lambda body), javap signature:

```java
private static final kotlin.Unit Ϳ(com.xuncorp.voxzen.data.entity.Track,
                                   com.xuncorp.pisces.PiscesMediaItem,
                                   androidx.compose.ui.Ⴈ,          // PopupState
                                   com.xuncorp.voxzen.ui.navigation.Navigator,
                                   androidx.compose.runtime.State, // State<PiscesPlayer.State>
                                   androidx.compose.ui.ন)          // MenuFlyoutScope
```

It appends items through the Kotlin default-argument static bridge
`androidx.compose.ui.ন.Ϳ(ন scope, Function0 onClick, Function2 content)` (the menu item's
`@Composable` content lambda), i.e. host items go through the same bridge we reuse.

## FINAL SOLUTION (implemented, registration verified)

`hookMethod` needs only JVM class name + JVM method name + full **business** parameter type list —
no Kotlin names, no `@Metadata` association:

```kotlin
WorkshopApi.hookRegistrar.hookMethod(
    "androidx.compose.ui.ē",                    // PlayerMoreMenuFlyoutKt file facade
    "\u037f",                                   // obfuscated JVM name of the item-adding helper
    listOf(
        "com.xuncorp.voxzen.data.entity.Track",
        "com.xuncorp.pisces.PiscesMediaItem",
        "androidx.compose.ui.\u10a8",           // PopupState (Ⴈ)
        "com.xuncorp.voxzen.ui.navigation.Navigator",
        "androidx.compose.runtime.State",
        "androidx.compose.ui.\u09a8",           // MenuFlyoutScope (ন)
    ),
    object : MethodHook() {
        override fun after(call: MethodHookParam) {
            val scope = call.args[5]            // MenuFlyoutScope
            appendItem(scope, call.args[2])     // dedupe + reflect bridge below
        }
    }
)
```

Inside `after` (runs on the composition thread right after the 4 host items are appended):

```kotlin
val scopeCls = Class.forName("androidx.compose.ui.\u09a8")
val bridge = scopeCls.getDeclaredMethod(
    "\u037f", scopeCls, Function0::class.java, Function2::class.java)
bridge.isAccessible = true
val onClick: () -> Unit = { dismissPopup(); openFoliaWindow() }
val content: @Composable () -> Unit = { BasicText("Folia") }   // runtime type = Function2<Composer,Int,Unit>
bridge.invoke(null, scope, onClick, content)
```

- Dedupe: the scope implementation keeps items in a mutable list field `Ϳ` (U+037F); use it as a
  `WeakHashMap` key so recomposition does not add duplicate items.
- Dismiss: `PopupState.ԩ()` (ԩ = U+0529) = no-arg void method, resolved reflectively.
- Compile requirements: plugin applies `org.jetbrains.kotlin.plugin.compose` (Kotlin 2.4.20) and
  declares `compileOnly` compose runtime/foundation/material3 (`androidx.compose.*` classes are
  host-provided; **never bundle** a second Compose runtime in `lib/`).
- Verified: plugin log shows `hookMethod installed: com.xuncorp.voxzen.workshop.hooks.ԩ$ԯ@…` then
  `start done`; hook-poc evidence under `poc/hook/shots/`. Menu-open verification is the current
  remaining check (see task board).

## appendContent: why it fails on this host build (historical)

The earlier plan was `appendContent(className="…Ԭ", methodName="\u037f", inClass="androidx.compose.ui.ē",
parameter="content", scopeType=Class.forName("…ন"), parameterTypes=[F0,F2,F1], …)`. It always throws
`UI call missing or ambiguous: androidx.compose.ui.ē -> com.xuncorp.voxzen.ui.component.Ԭ.BlurPopupMenu (0 calls)`.

Root cause (decoded from host bytes, `work/host/dec_ws/.../hooks/Ԫ.kt` = WorkshopHookTargets and the
registrar): the engine resolves the target call, then requires `parameter` to be one of the target's
**business parameter names** (`UiTarget.names`). Those names come from (a) JVM `MethodParameters`
attributes or (b) Kotlin `@Metadata` functions — and for (b) the metadata's *original* JVM method
signature must match the runtime method name. R8 renamed the JVM methods (all composables share the
name `Ϳ`, U+037F) while `@Metadata` still stores the original names (`BlurPopupMenu`,
`MenuFlyoutItemCompat`, …), so no function associates → `names` are all empty strings →
`indexOf("content") = -1` → exception (bytecode check requires index ≥ 0 **and** that param's type
be `kotlin.jvm.functions.Function1`). Also no `MethodParameters` attribute is emitted. This is a host
build limitation for *all* plugins, not specific to our target.

Consequence: never rely on Kotlin names against SPW 1.19.0 targets; use `hookMethod` with JVM names +
parameter types, or `replaceComposable`/`afterComposable` (those resolve the *call site* by JVM name +
parameter types and do not need parameter names).

## Fallback plans if the helper hook ever breaks

- Plan B: `replaceComposable(className="com.xuncorp.voxzen.ui.component.Ԭ", methodName="\u037f",
  inClass="androidx.compose.ui.ē", parameterTypes=[F0,F2,F1], …)` and re-implement the 4 host items +
  Folia item inside our own Composable (host singletons via reflection: `PlaybackController.INSTANCE`,
  `AppConfig.INSTANCE`, navigator; see `docs/archive/re-host.md`).
- Plan C: `replaceComposable` on `PlayerMoreMenuFlyout` at its call site inside
  `com.xuncorp.voxzen.ui.player.mini.֏` (MiniPlayerMenu.kt) — same effect, different injection point.
- Plan D: hook `MenuFlyoutScope` item append implementation instead of the builder helper (harder:
  needs to detect the host's 4th item to append after it).
- Diagnostics: host exceptions surface in `…\Salt Player for Windows\logs.txt`; the plugin also writes
  `spw-folia.log` in its own install dir.

## Re-derivation recipes (if the target changes with an SPW update)

1. Class-name→original-source map: `work/host/smap.json` (17,661 obfuscated classes → `.kt` file names).
   `PlayerMoreMenuFlyout.kt → androidx/compose/ui/ē.class`, `Blur.kt → com/xuncorp/voxzen/ui/component/Ԭ.class`.
2. Extract classes: Python `zipfile` on
   `C:\Program Files\WindowsApps\Sakawish.SaltPlayerforWindows_1.19.0.0_x64__q65q631pyh094\app\ffmpeg-x64.dll`
   (polyglot jar; `unzip` fails). Then `java -jar work/host/vineflower.jar -dgs=1 <inDir> <outDir>` → `.kt`.
3. javap (JDK 25): `"/c/Program Files/Java/jdk-25.0.2/bin/javap.exe" -J-Dstdout.encoding=UTF-8 -p -s <file>`
   (write to file + read as UTF-8; console garbles the obfuscated unicode names).
4. Decode Kotlin `@Metadata` d1/d2 (original names, but renamed JVM signatures): `work/host/tools/`
   `ParseMeta.java` / `ListMethods.java` / `ResolveTest.java` (compile+run against the polyglot jar
   directly), dumps `work/host/d2_dump.txt`, `work/host/blur_d2_strings.txt`.
5. All jar entries: `work/host/entries.txt`.

## Codepoints (copy-paste safety)

| glyph | codepoint | name / role |
|---|---|---|
| ē | U+0113 | PlayerMoreMenuFlyoutKt file facade |
| Ԭ | U+052C | Blur.kt file facade |
| ন | U+09A8 | MenuFlyoutScope interface |
| Ϳ | U+037F | shared obfuscated JVM method name (builder helper, scope item bridge, list field) |
| ઠ | U+0AA0 | host menu-item content lambda factories |
| Ⴈ | U+10A8 | PopupState |
| ԩ | U+0529 | PopupState.dismiss() |
