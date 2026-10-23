@file:OptIn(UnstableSpwWorkshopApi::class)
@file:Suppress("unused")

package dev.spw.folia

import androidx.compose.runtime.Composable
import com.xuncorp.spw.workshop.api.PluginContext
import com.xuncorp.spw.workshop.api.PluginPermission
import com.xuncorp.spw.workshop.api.SpwPlugin
import com.xuncorp.spw.workshop.api.UnstableSpwWorkshopApi
import com.xuncorp.spw.workshop.api.WorkshopApi
import com.xuncorp.spw.workshop.api.hook.HookHandle
import com.xuncorp.spw.workshop.api.hook.MethodHook
import com.xuncorp.spw.workshop.api.hook.MethodHookParam
import java.awt.Color
import java.awt.Toolkit
import java.awt.event.KeyEvent
import java.awt.event.WindowAdapter
import java.awt.event.WindowEvent
import java.io.File
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.time.LocalDateTime
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.ConcurrentHashMap
import javax.swing.JComponent
import javax.swing.JFrame
import javax.swing.JLabel
import javax.swing.KeyStroke
import javax.swing.SwingConstants
import javax.swing.SwingUtilities

/**
 * spw-folia workshop plugin.
 *
 * Adds a "Folia" entry to the SPW 更多 (more) flyout of the mini-player bar and opens the real
 * Folia fullscreen visualizer when it is clicked: the plugin spawns the native helper
 * `spw-folia-host.exe` (C# + WebView2, ships Folia's production web bundle) and drives it over
 * the protocol-v1 JSON-lines bridge in [FoliaHostBridge].
 *
 * Why hookMethod instead of appendContent (SPW 1.19.0, R8-obfuscated host build):
 *  - appendContent needs a *parameter name* of the target call, resolved from Kotlin
 *    @Metadata + MethodParameters. In this host build R8 renamed the JVM methods while
 *    @Metadata JvmMethodSignature keeps the original names, and no MethodParameters
 *    attribute is emitted, so the host hook engine cannot associate metadata parameter
 *    names with the real JVM method -> "UI call missing or ambiguous (0 calls)".
 *  - hookMethod only needs className + JVM method name + full JVM parameter type list.
 *    We hook the non-composable helper that adds the four host menu items and append
 *    our item to the MenuFlyoutScope after it returns.
 *
 * Host targets are resolved at runtime by [HostTargets] instead of being pinned to one build:
 * SPW is R8-obfuscated, so 1.19.1/1.19.2 renamed every class and method we touch (the 1.19.0
 * pair `ē`/`ন`/`Ⴈ` became `घ`/`Ը`/`ะ`). Known builds are matched by a validated profile, unknown
 * ones by a structural classpath scan, and the outcome is cached per host version.
 */
class FoliaPlugin(
    pluginContext: PluginContext
) : SpwPlugin(pluginContext) {

    private var methodHook: HookHandle? = null

    /** Legacy Swing fallback, only used when the native helper cannot be found/spawned. */
    private var swingFallbackWindow: JFrame? = null

    /** Guards against duplicate items when the menu content recomposes. Key = scope backing list. */
    private val appendedLists = Collections.synchronizedMap(WeakHashMap<Any, Boolean>())

    private val bridge = FoliaHostBridge(File(pluginContext.pluginPath), ::log)
    private val settingsStore = FoliaSettingsStore(::log)
    private var settingsTree: String = "{}"

    /** Host build this process runs on, e.g. 1.19.2. */
    private val hostVersion: HostTargets.Version? =
        HostTargets.Version.parse(pluginContext.spwVersion)

    /** Menu injection target for this host build; null until [HostTargets] resolved it. */
    @Volatile
    private var menuTarget: HostTargets.MenuTarget? = null

    /** Fields of MenuFlyoutScope implementations that hold the item list, cached per class. */
    private val scopeListFields = ConcurrentHashMap<String, Field?>()

    override fun start() {
        instance = this
        log(
            "start: id=${pluginContext.pluginId} version=${pluginContext.pluginVersion} " +
                "spw=${pluginContext.spwVersion} channel=${pluginContext.spwChannel} path=${pluginContext.pluginPath}"
        )
        runCatching {
            WorkshopApi.ui.toast("spw-folia loaded", WorkshopApi.Ui.ToastType.Success)
        }.onFailure { log("toast failed: $it") }

        settingsTree = settingsStore.load()
        bridge.settingsTree = settingsTree
        bridge.hostVersion = pluginContext.spwVersion
        // Fallback snapshot keeps the state line flowing at 100 ms even if the PF4J extension is
        // not instantiated yet (proves the bridge/clocks even on a bare host); the extension
        // replaces it as soon as PF4J creates it from META-INF/extensions.idx.
        bridge.snapshotProvider = {
            FoliaPlaybackExtension.get()?.snapshot() ?: PlaybackSnapshot(0L, 0L, false, 1.0)
        }
        bridge.lyricsProvider = { FoliaPlaybackExtension.get()?.lyricsJson() }
        bridge.trackProvider = { FoliaPlaybackExtension.get()?.trackJson() }
        // v0.3.0 playback bar: queue snapshot + controls (reflection over the host player).
        bridge.queueProvider = { FoliaPlaybackControls.queueJson() }
        bridge.onSettingsFromPage = { tree ->
            settingsTree = tree
            settingsStore.persist(tree)
        }
        bridge.onClosed = { reason -> log("folia window closed (reason=$reason); plugin stays loaded") }
        startExtensionWatch()

        val version = hostVersion
        if (version == null || version < HostTargets.Version.MIN_SUPPORTED) {
            log(
                "unsupported SPW version ${pluginContext.spwVersion} " +
                    "(need >= ${HostTargets.Version.MIN_SUPPORTED}); hook not installed"
            )
            return
        }
        if (!runCatching { WorkshopApi.manager.isPermissionGranted(PluginPermission.CLASS_TRANSFORM) }
                .getOrDefault(false)
        ) {
            log("CLASS_TRANSFORM not granted; hook not installed")
            toast("spw-folia: class-transform permission missing", WorkshopApi.Ui.ToastType.Error)
            return
        }
        installHookForHostBuild()
        log("start done")
    }

    /**
     * Installs the flyout hook on this host build.
     *
     * Known builds (cache + profiles) resolve instantly and are hooked before `start()` returns —
     * the historical behaviour. An unknown build needs a classpath scan of the host jar, so it runs
     * on a background thread to keep the host UI start-up free of a one-off 1-2 s stall; the
     * registration is retried because the hook API only accepts the starting/started plugin.
     */
    private fun installHookForHostBuild() {
        val dir = File(pluginContext.pluginPath)
        val version = pluginContext.spwVersion
        if (HostTargets.quickLoad(dir, version, ::log)) {
            installHook()
            return
        }
        log("host build $version matched no known profile; scanning the host classpath in the background")
        val worker = Thread({
            val target = HostTargets.deepResolve(dir, version, ::log)
            if (target == null) {
                log("WARNING: could not locate the 更多 flyout in ${pluginContext.spwVersion}; the Folia menu item will be missing")
                return@Thread
            }
            for (attempt in 1..HOOK_RETRY_COUNT) {
                if (installHook()) return@Thread
                Thread.sleep(HOOK_RETRY_DELAY_MS)
                log("hook retry $attempt/${HOOK_RETRY_COUNT} after registration failure")
            }
        }, "spw-folia-target-resolve")
        worker.isDaemon = true
        worker.start()
    }

    override fun stop() {
        log("stop")
        runCatching { methodHook?.unhook() }.onFailure { log("unhook failed: $it") }
        methodHook = null
        runCatching { bridge.stop() }.onFailure { log("bridge stop failed: $it") }
        runCatching { settingsStore.shutdown() }
        runCatching { FoliaPlaybackExtension.get()?.shutdown() }
        SwingUtilities.invokeLater { swingFallbackWindow?.dispose() }
        instance = null
    }

    override fun delete() {
        log("delete")
        runCatching { bridge.stop() }.onFailure { log("bridge stop failed: $it") }
        runCatching { settingsStore.shutdown() }
        runCatching { FoliaPlaybackExtension.get()?.shutdown() }
    }

    override fun update() {
        log("update")
    }

    /**
     * PF4J instantiates `@Extension` classes from `META-INF/extensions.idx` after the plugin class
     * loads. Logs when the playback extension appears (or never does) so the integration log always
     * tells whether the playback bridge is wired.
     */
    private fun startExtensionWatch() {
        val worker = Thread({
            val startedAt = System.currentTimeMillis()
            var reported = false
            while (System.currentTimeMillis() - startedAt < EXTENSION_WATCH_MS) {
                val extension = FoliaPlaybackExtension.get()
                if (extension != null) {
                    log("playback extension discovered: ${extension::class.java.name}")
                    reported = true
                    break
                }
                Thread.sleep(500L)
            }
            if (!reported) {
                log(
                    "WARNING: PlaybackExtensionPoint extension was not instantiated within " +
                        "${EXTENSION_WATCH_MS / 1000}s - check META-INF/extensions.idx in the plugin jar"
                )
            }
        }, "spw-folia-ext-watch")
        worker.isDaemon = true
        worker.start()
    }

    // ---------------------------------------------------------------- hook ----

    private fun installHook(): Boolean {
        val target = HostTargets.menu ?: menuTarget
        if (target == null) {
            log("installHook: no host menu target resolved yet")
            return false
        }
        val result = runCatching {
            WorkshopApi.hookRegistrar.hookMethod(
                target.menuClass,
                target.addItemsMethod,
                target.addItemsParams,
                object : MethodHook() {
                    override fun after(call: MethodHookParam) {
                        try {
                            val args = call.args
                            if (args.size < 6) {
                                log("after: unexpected args size ${args.size}")
                                return
                            }
                            val scope = args[5]
                            if (scope == null) {
                                log("after: null MenuFlyoutScope")
                                return
                            }
                            appendFoliaItem(scope, args[2], target)
                        } catch (t: Throwable) {
                            log("after hook error: ${t::class.java.name}: ${t.message}")
                        }
                    }
                }
            )
        }
        result.onSuccess {
            methodHook = it
            menuTarget = target
            log("hookMethod installed: $it (${target.origin})")
            toast("spw-folia: Folia menu item hook installed", WorkshopApi.Ui.ToastType.Success)
        }.onFailure {
            log("hookMethod FAILED: ${it::class.java.name}: ${it.message}")
            toast("spw-folia: hook failed (${it.message})", WorkshopApi.Ui.ToastType.Error)
        }
        return result.isSuccess
    }

    /**
     * Appends one "Folia" item to the live MenuFlyoutScope.
     *
     * Host's own helper adds its four items through the Kotlin default-argument bridge
     * `MenuFlyoutScope.item(onClick, content)` — a static JVM method on the scope interface itself,
     * whose name is resolved per host build by [HostTargets]. It calls the interface implementation
     * `item(onClick, enabled=true, content)`, exactly like the host's four items, so the popup
     * renders our item too.
     */
    private fun appendFoliaItem(scope: Any, popupState: Any?, target: HostTargets.MenuTarget) {
        val dedupeKey = scopeBackingList(scope) ?: scope
        if (appendedLists.putIfAbsent(dedupeKey, true) != null) {
            return
        }
        try {
            val scopeClass = Class.forName(target.scopeClass)
            val function0 = Class.forName("kotlin.jvm.functions.Function0")
            val function2 = Class.forName("kotlin.jvm.functions.Function2")
            val bridgeMethod: Method = scopeClass.getDeclaredMethod(
                target.scopeBridge, scopeClass, function0, function2
            )

            val onClick: () -> Unit = {
                log("Folia item clicked")
                runCatching { dismissPopup(popupState, target) }
                    .onFailure { log("dismissPopup failed: ${it::class.java.name}: ${it.message}") }
                openFolia()
            }
            val content: @Composable () -> Unit = {
                FoliaMenuItemContent()
            }

            bridgeMethod.isAccessible = true
            bridgeMethod.invoke(null, scope, onClick, content)
            log("Folia item appended (scope=${scope.javaClass.name}, bridge=${bridgeMethod.name})")
        } catch (t: Throwable) {
            log("appendFoliaItem error: ${t::class.java.name}: ${t.message}")
        }
    }

    /**
     * The MenuFlyoutScope implementation keeps its items in a `List` field. 1.19.0 and 1.19.2 both
     * name it Ϳ, but the field is discovered by type so a rename cannot break the recomposition
     * de-duplication (a null result simply degrades to keying on the scope instance).
     */
    private fun scopeBackingList(scope: Any): Any? {
        val field = scopeListFields.computeIfAbsent(scope.javaClass.name) { _ ->
            runCatching {
                scope.javaClass.declaredFields.firstOrNull {
                    java.util.List::class.java.isAssignableFrom(it.type) &&
                        !java.lang.reflect.Modifier.isStatic(it.modifiers)
                }?.apply { isAccessible = true }
            }.getOrNull()
        } ?: return null
        return runCatching { field.get(scope) }.getOrNull()
    }

    private fun dismissPopup(popupState: Any?, target: HostTargets.MenuTarget) {
        if (popupState == null) return
        val dismiss: Method? = target.popupDismiss?.let { name ->
            popupState.javaClass.methods.firstOrNull {
                it.name == name && it.parameterCount == 0 && it.returnType == Void.TYPE
            }
        }
        if (dismiss == null) {
            log("dismissPopup: no dismiss method on ${popupState.javaClass.name}")
            return
        }
        dismiss.isAccessible = true
        dismiss.invoke(popupState)
    }

    // -------------------------------------------------------------- window ----

    /**
     * Opens the real Folia window (native WebView2 helper) and streams playback into it.
     * Falls back to the Swing placeholder only when the helper cannot be located/spawned.
     */
    private fun openFolia() {
        bridge.settingsTree = settingsTree
        val started = try {
            bridge.open()
        } catch (t: Throwable) {
            log("bridge open failed: ${t::class.java.name}: ${t.message}")
            false
        }
        if (started) {
            log("Folia window requested (helper pid=${bridge.pidOrNull()})")
        } else {
            log("helper unavailable, opening Swing fallback window")
            openSwingFallbackWindow()
        }
    }

    private fun openSwingFallbackWindow() {
        SwingUtilities.invokeLater {
            try {
                swingFallbackWindow?.let { existing ->
                    if (existing.isDisplayable) {
                        existing.toFront()
                        existing.requestFocus()
                        return@invokeLater
                    }
                }
                val frame = JFrame("Folia")
                frame.isUndecorated = true
                frame.background = Color.BLACK
                frame.contentPane.background = Color.BLACK
                frame.addWindowListener(object : WindowAdapter() {
                    override fun windowClosed(e: WindowEvent) {
                        swingFallbackWindow = null
                        log("fallback window closed")
                    }
                })
                val label = JLabel("Folia (fallback)", SwingConstants.CENTER)
                label.foreground = Color(0x33, 0xDD, 0x77)
                label.font = label.font.deriveFont(48f)
                frame.contentPane.add(label)
                frame.rootPane.registerKeyboardAction(
                    { frame.dispose() },
                    KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0),
                    JComponent.WHEN_IN_FOCUSED_WINDOW
                )
                val screen = Toolkit.getDefaultToolkit().screenSize
                frame.setSize(screen)
                frame.setLocation(0, 0)
                frame.isAlwaysOnTop = true
                frame.isVisible = true
                frame.requestFocus()
                swingFallbackWindow = frame
                log("fallback fullscreen window opened ($screen)")
            } catch (t: Throwable) {
                log("openSwingFallbackWindow error: ${t::class.java.name}: ${t.message}")
            }
        }
    }

    // --------------------------------------------------------------- misc ----

    private fun toast(text: String, type: WorkshopApi.Ui.ToastType) {
        runCatching { WorkshopApi.ui.toast(text, type) }.onFailure { log("toast failed: $it") }
    }

    fun log(message: String) {
        runCatching {
            val file = File(pluginContext.pluginPath, "spw-folia.log")
            file.parentFile?.mkdirs()
            file.appendText("[${LocalDateTime.now()}] $message\n")
        }
    }

    companion object {
        /** Shown in the helper handshake until [start] forwards the real host version. */
        const val SPW_VERSION = "1.19.0"
        const val PLUGIN_VERSION = "0.3.1"

        /** How long the start-up watcher waits for PF4J to instantiate the playback extension. */
        private const val EXTENSION_WATCH_MS = 20_000L

        /** Hook registration retries while the plugin's "started" transition settles. */
        private const val HOOK_RETRY_COUNT = 20
        private const val HOOK_RETRY_DELAY_MS = 500L

        /** Dev checkout root, used only as a fallback while assets are not packaged next to the plugin. */
        private const val DEV_ROOT = "D:/输出目录/dsh2"

        @Volatile
        private var instance: FoliaPlugin? = null

        fun devRoot(): File = File(DEV_ROOT)

        fun logStatic(message: String) {
            instance?.log(message)
        }
    }
}
