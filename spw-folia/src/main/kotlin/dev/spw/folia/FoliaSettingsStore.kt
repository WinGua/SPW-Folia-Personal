@file:OptIn(UnstableSpwWorkshopApi::class)

package dev.spw.folia

import com.xuncorp.spw.workshop.api.UnstableSpwWorkshopApi
import com.xuncorp.spw.workshop.api.WorkshopApi
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Opaque persistence for the Folia settings tree.
 *
 * The tree is produced by the settings UI (canonical JSON, see packaging/testdata/default-settings.json)
 * and must be stored + replayed byte-identically: the plugin never interprets it.
 *
 * The host API's ConfigHelper can only store String / Number / Boolean, so the whole tree lives
 * under one String key ("settingsJson"). Writes are debounced (~200 ms) and skipped when the
 * tree did not change — the page can emit the same tree on every tiny interaction, and a
 * synchronous save per message caused an echo storm in an earlier spike.
 */
internal class FoliaSettingsStore(
    private val log: (String) -> Unit
) {

    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "spw-folia-settings").apply { isDaemon = true }
    }

    @Volatile private var lastSaved: String? = null
    @Volatile private var pending: String? = null
    private var pendingSince: Long = 0L

    /** Loads the persisted tree, falling back to the bundled canonical default tree. */
    fun load(): String {
        val stored = try {
            val helper = WorkshopApi.manager.createConfigManager().getConfig()
            @Suppress("UNCHECKED_CAST")
            val value = helper.get("settingsJson", "") as? String
            value?.takeIf { it.isNotBlank() && it.trim().startsWith("{") }
        } catch (t: Throwable) {
            log("settings load failed: ${t::class.java.name}: ${t.message}")
            null
        }
        val tree = stored ?: defaultTree()
        lastSaved = tree
        log("settings loaded (${tree.length} bytes, ${if (stored != null) "persisted" else "default"})")
        return tree
    }

    /** Debounced persist. No-op when the tree equals the last saved one. */
    fun persist(tree: String) {
        if (tree == lastSaved) return
        pending = tree
        synchronized(this) {
            if (pendingSince == 0L) {
                pendingSince = System.currentTimeMillis()
            }
        }
        // scheduleAtFixedRate is idempotent enough here: only the first call schedules the flusher.
        if (!flusherArmed) {
            flusherArmed = true
            executor.scheduleAtFixedRate({ flushIfDue() }, DEBOUNCE_MS, DEBOUNCE_MS, TimeUnit.MILLISECONDS)
        }
    }

    private fun flushIfDue() {
        val tree = pending ?: return
        synchronized(this) {
            val since = pendingSince
            if (since == 0L || System.currentTimeMillis() - since < DEBOUNCE_MS) return
            pendingSince = 0L
            pending = null
        }
        if (tree == lastSaved) return
        try {
            val helper = WorkshopApi.manager.createConfigManager().getConfig()
            helper.set("settingsJson", tree)
            val ok = helper.save()
            lastSaved = tree
            log("settings saved (${tree.length} bytes, ok=$ok)")
        } catch (t: Throwable) {
            log("settings save failed: ${t::class.java.name}: ${t.message}")
        }
    }

    fun shutdown() {
        executor.shutdownNow()
    }

    private fun defaultTree(): String {
        val candidates = listOf(
            { javaClass.getResourceAsStream("/default-settings.json") },
            { File(FoliaPlugin.devRoot(), "packaging/testdata/default-settings.json").inputStream() }
        )
        for (candidate in candidates) {
            try {
                val stream = candidate() ?: continue
                return stream.bufferedReader(Charsets.UTF_8).use { it.readText() }.trim()
            } catch (_: Throwable) {
            }
        }
        return "{}"
    }

    companion object {
        private const val DEBOUNCE_MS = 200L

        @Volatile
        private var flusherArmed = false
    }
}
