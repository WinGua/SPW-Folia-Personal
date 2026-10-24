@file:OptIn(UnstableSpwWorkshopApi::class)

package dev.spw.folia

import com.xuncorp.spw.workshop.api.UnstableSpwWorkshopApi
import com.xuncorp.spw.workshop.api.WorkshopApi
import com.xuncorp.spw.workshop.api.config.ConfigHelper
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
        var helper: ConfigHelper? = null
        val stored = try {
            helper = WorkshopApi.manager.createConfigManager().getConfig()
            @Suppress("UNCHECKED_CAST")
            val value = helper.get("settingsJson", "") as? String
            value?.takeIf { it.isNotBlank() && it.trim().startsWith("{") }
        } catch (t: Throwable) {
            log("settings load failed: ${t::class.java.name}: ${t.message}")
            null
        }
        var tree = stored ?: defaultTree()
        if (stored != null) {
            helper?.let { tree = migrateTextureDefault(it, tree) }
        }
        lastSaved = tree
        log("settings loaded (${tree.length} bytes, ${if (stored != null) "persisted" else "default"})")
        return tree
    }

    /**
     * One-time normalization of the old texture-resolution default.
     *
     * Older builds (and the pre-built settings UI shipped in the base package) used 1.5 as the
     * default, which the UI could write back into the persisted tree before hydration. Replace it
     * with 1.0 once and remember that the migration ran, so a user's later deliberate choice of
     * 1.5 is never overwritten again.
     */
    private fun migrateTextureDefault(helper: ConfigHelper, tree: String): String {
        val migrated = try {
            helper.get(KEY_TEXTURE_MIGRATED, false) as? Boolean ?: false
        } catch (_: Throwable) {
            false
        }
        if (migrated) return tree
        val updated = TEXTURE_15.replace(tree, "\"textureResolution\":1")
        try {
            if (updated != tree) {
                helper.set("settingsJson", updated)
                log("settings migrated: textureResolution 1.5 -> 1.0")
            }
            helper.set(KEY_TEXTURE_MIGRATED, true)
            helper.save()
        } catch (t: Throwable) {
            log("settings migration failed: ${t::class.java.name}: ${t.message}")
        }
        return updated
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

        /** Config key marking the 1.5 -> 1.0 texture default migration as done. */
        private const val KEY_TEXTURE_MIGRATED = "textureDefaultMigrated"

        /** `"textureResolution":1.5` in the compact JSON the settings UI persists. */
        private val TEXTURE_15 = Regex("\"textureResolution\"\\s*:\\s*1\\.5(?=[,}])")

        @Volatile
        private var flusherArmed = false
    }
}
