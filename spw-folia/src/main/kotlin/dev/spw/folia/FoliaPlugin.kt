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
import java.lang.reflect.Method
import java.time.LocalDateTime
import java.util.Collections
import java.util.WeakHashMap
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
 * Host pins (SPW 1.19.0):
 *  - menu file facade: androidx.compose.ui.ē  (PlayerMoreMenuFlyoutKt)
 *  - item-adding helper:  ē.Ϳ(Track, PiscesMediaItem, PopupState, Navigator, State, MenuFlyoutScope)
 *  - MenuFlyoutScope interface: androidx.compose.ui.ন; item bridge:
 *      static ন.Ϳ(ন scope, Function0 onClick, Function2 content)
 *  - PopupState: androidx.compose.ui.Ⴈ; dismiss = Ⴈ.ԩ()
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
        // Fallback snapshot keeps the state line flowing at 100 ms even if the PF4J extension is
        // not instantiated yet (proves the bridge/clocks even on a bare host); the extension
        // replaces it as soon as PF4J creates it from META-INF/extensions.idx.
        bridge.snapshotProvider = {
            FoliaPlaybackExtension.get()?.snapshot() ?: PlaybackSnapshot(0L, 0L, false, 1.0)
        }
        bridge.lyricsProvider = { FoliaPlaybackExtension.get()?.lyricsJson() }
        bridge.trackProvider = { FoliaPlaybackExtension.get()?.trackJson() }
        bridge.onSettingsFromPage = { tree ->
            settingsTree = tree
            settingsStore.persist(tree)
        }
        bridge.onClosed = { reason -> log("folia window closed (reason=$reason); plugin stays loaded") }
        startExtensionWatch()

        if (pluginContext.spwVersion != SPW_VERSION) {
            log("unsupported SPW version ${pluginContext.spwVersion}; hook not installed")
            return
        }
        if (!runCatching { WorkshopApi.manager.isPermissionGranted(PluginPermission.CLASS_TRANSFORM) }
                .getOrDefault(false)
        ) {
            log("CLASS_TRANSFORM not granted; hook not installed")
            toast("spw-folia: class-transform permission missing", WorkshopApi.Ui.ToastType.Error)
            return
        }
        installHook()
        log("start done")
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

    private fun installHook() {
        val result = runCatching {
            WorkshopApi.hookRegistrar.hookMethod(
                MENU_FILE_CLASS,
                ADD_ITEMS_METHOD,
                ADD_ITEMS_PARAM_TYPES,
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
                            appendFoliaItem(scope, args[2])
                        } catch (t: Throwable) {
                            log("after hook error: ${t::class.java.name}: ${t.message}")
                        }
                    }
                }
            )
        }
        result.onSuccess {
            methodHook = it
            log("hookMethod installed: $it")
            toast("spw-folia: Folia menu item hook installed", WorkshopApi.Ui.ToastType.Success)
        }.onFailure {
            log("hookMethod FAILED: ${it::class.java.name}: ${it.message}")
            toast("spw-folia: hook failed (${it.message})", WorkshopApi.Ui.ToastType.Error)
        }
    }

    /**
     * Appends one "Folia" item to the live MenuFlyoutScope.
     *
     * Host's own helper adds its four items through the Kotlin default-argument bridge
     * `MenuFlyoutScope.item(onClick, content)` (static JVM method ন.Ϳ(ন, Function0, Function2)).
     * This bridge calls the interface `item(onClick, enabled=true, content)` implementation,
     * which is exactly what the host's four items do, so the popup renders our item too.
     */
    private fun appendFoliaItem(scope: Any, popupState: Any?) {
        val dedupeKey = scopeBackingList(scope) ?: scope
        if (appendedLists.putIfAbsent(dedupeKey, true) != null) {
            return
        }
        try {
            val scopeClass = Class.forName(SCOPE_CLASS)
            val function0 = Class.forName("kotlin.jvm.functions.Function0")
            val function2 = Class.forName("kotlin.jvm.functions.Function2")
            val bridgeMethod: Method = scopeClass.getDeclaredMethod(
                ITEM_BRIDGE_METHOD, scopeClass, function0, function2
            )

            val onClick: () -> Unit = {
                log("Folia item clicked")
                runCatching { dismissPopup(popupState) }
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

    /** The MenuFlyoutScope implementation keeps its items in a mutable List field (U+037F). */
    private fun scopeBackingList(scope: Any): Any? = try {
        val field = scope.javaClass.getDeclaredField(SCOPE_LIST_FIELD)
        field.isAccessible = true
        field.get(scope)
    } catch (t: Throwable) {
        null
    }

    private fun dismissPopup(popupState: Any?) {
        if (popupState == null) return
        val dismiss: Method? = popupState.javaClass.methods.firstOrNull {
            it.name == POPUP_DISMISS_METHOD &&
                it.parameterCount == 0 &&
                it.returnType == Void.TYPE
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
        const val SPW_VERSION = "1.19.0"
        const val PLUGIN_VERSION = "0.1.8"

        /** How long the start-up watcher waits for PF4J to instantiate the playback extension. */
        private const val EXTENSION_WATCH_MS = 20_000L

        /** androidx.compose.ui.ē — PlayerMoreMenuFlyoutKt file facade. */
        private const val MENU_FILE_CLASS = "androidx.compose.ui.\u0113"

        /** Obfuscated JVM name of the helper that adds the four host menu items. */
        private const val ADD_ITEMS_METHOD = "\u037f"

        /** Full JVM parameter type list of that helper (exact match required by hookMethod). */
        private val ADD_ITEMS_PARAM_TYPES = listOf(
            "com.xuncorp.voxzen.data.entity.Track",
            "com.xuncorp.pisces.PiscesMediaItem",
            "androidx.compose.ui.\u10a8",              // PopupState
            "com.xuncorp.voxzen.ui.navigation.Navigator",
            "androidx.compose.runtime.State",
            "androidx.compose.ui.\u09a8"               // MenuFlyoutScope
        )

        /** androidx.compose.ui.ন — MenuFlyoutScope. */
        private const val SCOPE_CLASS = "androidx.compose.ui.\u09a8"

        /** Static default-argument bridge `MenuFlyoutScope.item(onClick, content)`. */
        private const val ITEM_BRIDGE_METHOD = "\u037f"

        /** Field of the MenuFlyoutScope implementation that holds the item list. */
        private const val SCOPE_LIST_FIELD = "\u037f"

        /** PopupState.ԩ() — close the flyout. */
        private const val POPUP_DISMISS_METHOD = "\u0529"

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
