package dev.spw.folia

import java.io.BufferedWriter
import java.io.File
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Owns the `spw-folia-host.exe` helper process and the protocol-v1 JSON-lines bridge.
 *
 * Protocol (docs/protocol.md v1, verified against poc/webview/host/Program.cs + HostForm.cs):
 *  - plugin -> helper (stdin):  {"t":"hello"...}, {"t":"settings"...}, {"t":"state"...},
 *    {"t":"lyrics"...}, {"t":"track"...}, {"t":"quit"}
 *  - helper -> plugin (stdout): {"t":"ready"...}, {"t":"closed","reason":...},
 *    {"t":"settings","settings":{...}}, {"t":"action"...}, {"t":"log"...}
 *
 * The helper reads stdin on a dedicated thread; EOF (plugin process death) closes it, so a
 * double safety net (quit on stop + stdin EOF) keeps no orphan processes around.
 */
internal class FoliaHostBridge(
    private val pluginPath: File,
    private val log: (String) -> Unit
) {

    @Volatile private var process: Process? = null
    @Volatile private var ready = false
    @Volatile private var stopping = false

    /**
     * v0.1.11: the helper's stdin is now written exclusively by one daemon thread fed from a bounded
     * queue. The old `sendLine` wrote *inside synchronized(this)*, so once the helper stopped reading
     * (its stdin pump could die, see the v0.1.11 host fix) the JVM blocked forever inside
     * `OutputStreamWriter.flush()` **while holding the very monitor** that `open()`/`stop()`/
     * `cleanup()`/`mirrorStdout()` also need. `open()` is called straight from the Compose UI thread
     * when the user clicks 更多 -> Folia, so a wedged helper froze all of SPW ("未响应" -> force close).
     * With a dedicated writer nothing in SPW can ever block on the pipe again; back-pressure drops
     * the oldest queued line instead (every line is perishable state, never a command that matters).
     */
    private val pendingLines = LinkedBlockingQueue<String>(WRITE_QUEUE_CAPACITY)
    private val stdoutLogLock = Any()
    @Volatile private var writerThread: Thread? = null
    @Volatile private var stdinBroken = false

    @Volatile private var pid: Long = -1L

    /** Opaque Folia settings tree (canonical JSON), updated from the page via stdout `settings`. */
    @Volatile var settingsTree: String? = null

    /** Called when the helper reports `closed` (window closed by user/helper); plugin stays loaded. */
    @Volatile var onClosed: ((String) -> Unit)? = null

    /** Called with the raw settings JSON whenever the page sends an updated tree. */
    @Volatile var onSettingsFromPage: ((String) -> Unit)? = null

    // Providers installed by FoliaPlugin; polled by the state pump.
    @Volatile var snapshotProvider: (() -> PlaybackSnapshot?)? = null
    @Volatile var lyricsProvider: (() -> String?)? = null
    @Volatile var trackProvider: (() -> String?)? = null

    private val lastSentTrack = AtomicReference<String?>(null)

    /**
     * Lyrics are tracked separately from the track (v0.1.8): SPW parses a new song's lyrics *after*
     * the track change, so gating the lyrics push on a track-string change meant the page kept the
     * previous song's lines until the cover (which also mutates the track JSON) arrived — or forever
     * when the cover load failed. The pump now diffs the cached lyrics JSON every tick.
     */
    private val lastSentLyrics = AtomicReference<String?>(null)
    private var pump: ScheduledExecutorService? = null
    private var pumpTicks = 0L
    private var lastLoggedPlaying: Boolean? = null
    private var stateLinesSent = 0L
    private var fpsLinesSeen = 0L
    private val droppedLines = AtomicLong(0L)
    private var stdoutLog: BufferedWriter? = null

    fun isRunning(): Boolean {
        val p = process
        return p != null && p.isAlive && !stopping
    }

    fun pidOrNull(): Long = pid

    // -------------------------------------------------------------- lifecycle ----

    /** Spawns the helper if needed, sends hello + settings. Returns true when the process is up. */
    @Synchronized
    fun open(): Boolean {
        if (isRunning()) {
            log("host already running (pid=$pid)")
            return true
        }
        val exe = resolveHelper()
        if (exe == null) {
            log("host helper not found (looked in pluginPath/host and dev checkout)")
            return false
        }
        val web = resolveWebDir()
        if (web == null) {
            log("web bundle not found (looked in pluginPath/web and dev checkout)")
            return false
        }
        val command = mutableListOf(
            exe.absolutePath,
            "--bundle", web.absolutePath,
            "--fullscreen",
            "--bundle-version", FoliaPlugin.PLUGIN_VERSION
        )
        val settingsDir = resolveSettingsDir(web)
        if (settingsDir != null) {
            command += listOf("--settings-dir", settingsDir.absolutePath, "--settings-entry", SETTINGS_ENTRY)
        }
        // cwd = plugin dir so every relative path inside the helper resolves against the install
        // location; all paths we pass are absolute anyway (cwd is only a safety net).
        val workDir = pluginPath.absoluteFile.also { it.mkdirs() }
        val stderrLog = File(workDir, "spw-folia-host.stderr.log")
        val stdoutLogFile = File(workDir, "spw-folia-host.stdout.log")
        log("spawn cmdline: " + command.joinToString(" "))
        log("spawn cwd=$workDir")
        log("spawn exe=${exe.absolutePath} web=${web.absolutePath} settingsDir=${settingsDir?.absolutePath}")
        log("spawn stdout=$stdoutLogFile stderr=$stderrLog")
        listOf("SPW_FOLIA_HELPER", "SPW_FOLIA_WEB", "SPW_FOLIA_SETTINGS").forEach { key ->
            System.getenv(key)?.let { log("spawn env $key=$it") }
        }
        stopping = false
        stdoutLog = try {
            stdoutLogFile.bufferedWriter(StandardCharsets.UTF_8)
        } catch (t: Throwable) {
            log("stdout log open failed: ${t::class.java.name}: ${t.message}")
            null
        }
        val builder = ProcessBuilder(command)
        builder.directory(workDir)
        builder.redirectError(ProcessBuilder.Redirect.appendTo(stderrLog))
        try {
            builder.redirectOutput(ProcessBuilder.Redirect.PIPE)
        } catch (_: Throwable) {
            // PIPE is already the default; keep going if the helper cannot be reconfigured.
        }
        val p = try {
            builder.start()
        } catch (t: Throwable) {
            log("spawn failed: ${t::class.java.name}: ${t.message}")
            return false
        }
        process = p
        pid = p.pid()
        ready = false
        stateLinesSent = 0
        fpsLinesSeen = 0
        pumpTicks = 0L
        lastLoggedPlaying = null
        lastSentTrack.set(null)
        lastSentLyrics.set(null)
        startStdoutReader(p)
        startExitWatcher(p)
        startStdinWriter(p)
        sendLine(
            "{\"t\":\"hello\",\"protocol\":1,\"pluginVersion\":${Json.str(FoliaPlugin.PLUGIN_VERSION)}," +
                "\"spwVersion\":${Json.str(FoliaPlugin.SPW_VERSION)},\"bundleDir\":${Json.str(web.absolutePath)}}"
        )
        settingsTree?.let { sendSettings(it) }
        log("host spawned pid=$pid")
        return true
    }

    /** Sends quit and waits for the helper to exit (force kill after 2 s). */
    @Synchronized
    fun stop() {
        val p = process ?: return
        stopping = true
        stopPump()
        sendLine("{\"t\":\"quit\"}")
        sendLine(WRITER_POISON)
        // Give the writer a moment to flush quit + poison into the pipe; it is a no-op when the
        // writer is already gone (stdinBroken), which `waitFor` below handles through the timeout.
        writerThread?.join(500)
        try {
            if (!p.waitFor(2, TimeUnit.SECONDS)) {
                log("helper did not exit in 2s, killing pid=$pid")
                p.destroyForcibly()
            }
        } catch (t: Throwable) {
            log("helper stop error: ${t::class.java.name}: ${t.message}")
            p.destroyForcibly()
        }
        cleanup("stopped")
    }

    // -------------------------------------------------------------- protocol ----

    fun sendSettings(settingsJson: String) {
        settingsTree = settingsJson
        sendLine("{\"t\":\"settings\",\"settings\":$settingsJson}")
    }

    fun sendState(snapshot: PlaybackSnapshot) {
        val line = "{\"t\":\"state\",\"posMs\":${Json.num(snapshot.posMs.toDouble())}," +
            "\"durationMs\":${Json.num(snapshot.durationMs.toDouble())}," +
            "\"playing\":${Json.bool(snapshot.playing)},\"rate\":${Json.num(snapshot.rate)}," +
            "\"tsMs\":${System.currentTimeMillis()}}"
        val sent = ++stateLinesSent
        // Protocol evidence: first lines verbatim, then one summary line every 10 s (100 ms pump).
        if (sent <= 2L || sent % 100L == 0L) log("state #$sent -> helper: $line")
        sendLine(line)
    }

    fun sendLyrics(linesJson: String) {
        lastSentLyrics.set(linesJson)
        sendLine("{\"t\":\"lyrics\",\"lines\":$linesJson,\"offsetMs\":0}")
    }

    /** Pushes the cached lyrics only when they changed; returns true when a line went out. */
    private fun maybeSendLyrics(force: Boolean = false): Boolean {
        val lyrics = lyricsProvider?.invoke() ?: return false
        if (!force && lyrics == lastSentLyrics.get()) return false
        log("lyrics -> helper (${lyrics.length} bytes${if (force) ", replay" else ""})")
        sendLyrics(lyrics)
        return true
    }

    fun sendTrack(trackJson: String) {
        lastSentTrack.set(trackJson)
        // Protocol v1 keeps the track fields at the top level of the line (no nested object).
        val body = trackJson.trim().removePrefix("{").removeSuffix("}")
        sendLine("{\"t\":\"track\",$body}")
    }

    private fun sendLine(line: String) {
        if (stdinBroken || writerThread == null) return
        // Bounded by design: when the helper stops draining the pipe we must not pile up 155 KB
        // track payloads unbounded. Drop the oldest buffered line - every message is idempotent
        // state (100 ms `state` cadence, lyrics/track snapshots), so the freshest line wins.
        while (!pendingLines.offer(line)) {
            val dropped = pendingLines.poll()
            if (dropped != null && dropped != WRITER_POISON) {
                val count = droppedLines.incrementAndGet()
                if (count <= 3L || count % 100L == 0L) {
                    log("stdin queue overflow, dropping buffered line #$count")
                }
            }
        }
    }

    /** The single owner of the helper's stdin. Any failure marks the pipe dead and drains it. */
    private fun startStdinWriter(p: Process) {
        pendingLines.clear()
        stdinBroken = false
        val out = BufferedWriter(OutputStreamWriter(p.outputStream, StandardCharsets.UTF_8))
        val thread = Thread({
            try {
                while (true) {
                    val line = pendingLines.take()
                    if (line == WRITER_POISON) break
                    out.write(line)
                    out.write("\n")
                    out.flush()
                }
            } catch (t: Throwable) {
                if (!stopping) log("stdin writer stopped: ${t::class.java.name}: ${t.message}")
            } finally {
                stdinBroken = true
                pendingLines.clear()
                try {
                    out.flush()
                    out.close()
                } catch (_: Throwable) {
                }
            }
        }, "spw-folia-host-stdin").apply { isDaemon = true }
        writerThread = thread
        thread.start()
    }

    // --------------------------------------------------------------- threads ----

    private fun startStdoutReader(p: Process) {
        Thread({
            try {
                val reader = p.inputStream.bufferedReader(StandardCharsets.UTF_8)
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isBlank()) continue
                    mirrorStdout(line)
                    handleHostLine(line)
                }
                log("host stdout EOF")
            } catch (t: Throwable) {
                if (!stopping) log("stdout reader error: ${t::class.java.name}: ${t.message}")
            }
        }, "spw-folia-host-stdout").apply { isDaemon = true }.start()
    }

    /** Mirrors every helper stdout line into spw-folia-host.stdout.log (raw protocol evidence). */
    private fun mirrorStdout(line: String) {
        // v0.1.11: log-file writes moved off the shared monitor (`this`), so they can never be
        // blocked behind - or block - a lifecycle call such as open()/stop() on the UI thread.
        val out: BufferedWriter? = stdoutLog
        if (out == null) return
        synchronized(stdoutLogLock) {
            try {
                out.write(line)
                out.write("\n")
                out.flush()
            } catch (_: Throwable) {
                // Diagnostics only; never break the bridge because of a log file.
            }
        }
    }

    private fun startExitWatcher(p: Process) {
        Thread({
            val code = try {
                p.waitFor()
            } catch (t: Throwable) {
                -1
            }
            if (!stopping) {
                log("host process exited code=$code")
                cleanup("exited")
            }
        }, "spw-folia-host-exit").apply { isDaemon = true }.start()
    }

    private fun handleHostLine(line: String) {
        when (val t = Json.stringField(line, "t")) {
            "ready" -> {
                ready = true
                log("host ready: $line")
                replaySnapshot()
                startPump()
            }
            "closed" -> {
                val reason = Json.stringField(line, "reason") ?: "?"
                log("host closed reason=$reason")
                cleanup(reason)
                onClosed?.invoke(reason)
            }
            "settings" -> {
                val raw = Json.rawField(line, "settings")
                if (raw != null) {
                    settingsTree = raw
                    log("host settings update (${raw.length} bytes)")
                    onSettingsFromPage?.invoke(raw)
                }
            }
            "action" -> log("host action: " + (Json.stringField(line, "name") ?: "?"))
            "log" -> {
                val level = Json.stringField(line, "level") ?: "info"
                val msg = Json.stringField(line, "msg") ?: ""
                log("host[$level] $msg")
            }
            "fps" -> {
                // Diagnostics for the tiny-viewport investigation (webview-spike task-9):
                // keep the first 5 fps lines verbatim, then one every 10 s, raw file has them all.
                val seen = ++fpsLinesSeen
                if (seen <= 5L || seen % 10L == 0L) log("host fps: $line")
            }
            else -> {
                if (t != "audio-stats" && t != "eval-result") {
                    log("host message: $line")
                }
            }
        }
    }

    private fun cleanup(reason: String) {
        stopPump()
        // Mark the pipe dead first so the pump thread stops queueing into a dead writer.
        stdinBroken = true
        writerThread = null
        pendingLines.clear()
        val dropped = droppedLines.getAndSet(0L)
        if (dropped > 0L) log("host cleanup ($reason): $dropped queued stdin lines were dropped")
        synchronized(stdoutLogLock) {
            try {
                stdoutLog?.flush()
                stdoutLog?.close()
            } catch (_: Throwable) {
            }
            stdoutLog = null
        }
        process = null
        ready = false
        pid = -1L
        log("host cleanup ($reason)")
    }

    // ------------------------------------------------------------- state pump ----

    /** On ready: pushes the current track/lyrics so a freshly opened window shows content at once. */
    private fun replaySnapshot() {
        val snapshot = snapshotProvider?.invoke()
        log("replay snapshot: ${if (snapshot == null) "none" else "pos=${snapshot.posMs} playing=${snapshot.playing}"}")
        snapshot?.let { sendState(it) }
        val track = trackProvider?.invoke()
        if (track != null && track != lastSentTrack.get()) {
            log("replay track (${track.length} bytes)")
            sendTrack(track)
        }
        maybeSendLyrics(force = true)
    }

    private fun startPump() {
        if (pump != null) return
        pumpTicks = 0
        val service = Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "spw-folia-pump").apply { isDaemon = true }
        }
        pump = service
        service.scheduleAtFixedRate({
            try {
                if (!ready) return@scheduleAtFixedRate
                snapshotProvider?.invoke()?.let { snapshot ->
                    if (pumpTicks < 3L || lastLoggedPlaying != snapshot.playing) {
                        lastLoggedPlaying = snapshot.playing
                        log(
                            "state -> helper: pos=${snapshot.posMs} dur=${snapshot.durationMs} " +
                                "playing=${snapshot.playing} rate=${snapshot.rate}"
                        )
                    }
                    sendState(snapshot)
                }
                pumpTicks++
                if (pumpTicks % TRACK_CHECK_EVERY_TICKS == 0L) {
                    trackProvider?.invoke()?.let { track ->
                        if (track != lastSentTrack.get()) {
                            log("track -> helper (${track.length} bytes, cover=${track.contains("\"coverDataUrl\"")})")
                            sendTrack(track)
                        }
                    }
                }
                // Lyrics ride the same pump but are diffed on their own: SPW delivers them a bit
                // after the track change, and a cover load failure must not freeze them (v0.1.8).
                maybeSendLyrics()
            } catch (t: Throwable) {
                log("pump error: ${t::class.java.name}: ${t.message}")
            }
        }, 0L, STATE_PERIOD_MS, TimeUnit.MILLISECONDS)
    }

    private fun stopPump() {
        pump?.shutdownNow()
        pump = null
    }

    // ---------------------------------------------------------------- resolve ----

    private fun resolveHelper(): File? {
        val candidates = mutableListOf<File>()
        System.getenv("SPW_FOLIA_HELPER")?.takeIf { it.isNotBlank() }?.let { candidates += File(it) }
        candidates += File(pluginPath, "host/spw-folia-host.exe")
        candidates += File(pluginPath, "host/x64/spw-folia-host.exe")
        // Release (.spmod) layout: helper binaries are packaged under lib/ (0.1.0 build 2) or
        // native/ (0.1.0 final release layout).
        candidates += File(pluginPath, "lib/spw-folia-host.exe")
        candidates += File(pluginPath, "lib/x64/spw-folia-host.exe")
        candidates += File(pluginPath, "native/spw-folia-host.exe")
        candidates += File(pluginPath, "native/x64/spw-folia-host.exe")
        // Dev checkout fallback (task-6 build output); harmless in a packaged plugin.
        candidates += File(DEV_ROOT, "poc/webview/host/build/spw-folia-host.exe")
        return candidates.firstOrNull { it.isFile }
    }

    private fun resolveWebDir(): File? {
        val candidates = mutableListOf<File>()
        System.getenv("SPW_FOLIA_WEB")?.takeIf { it.isNotBlank() }?.let { candidates += File(it) }
        candidates += File(pluginPath, "web")
        candidates += File(pluginPath, "web/dist")
        candidates += File(DEV_ROOT, "poc/webview/dist/dist")
        return candidates.firstOrNull { File(it, "index.html").isFile }
    }

    private fun resolveSettingsDir(web: File): File? {
        // Packaged layout: <bundle>/settings/settings-ui.js is auto-detected by the helper, so
        // no flag is needed there. Only pass explicit flags when the file lives elsewhere.
        if (File(web, "settings/$SETTINGS_ENTRY").isFile) return null
        val candidates = mutableListOf<File>()
        System.getenv("SPW_FOLIA_SETTINGS")?.takeIf { it.isNotBlank() }?.let { candidates += File(it) }
        candidates += File(pluginPath, "web/settings")
        candidates += File(DEV_ROOT, "poc/settings-ui/dist")
        return candidates.firstOrNull { File(it, SETTINGS_ENTRY).isFile }
    }

    companion object {
        /** 100 ms state cadence: docs/protocol.md asks for >=20 Hz; the timeline interpolates. */
        private const val STATE_PERIOD_MS = 100L

        /**
         * v0.1.11: bound for the stdin writer queue. Large enough to absorb a ~155 KB track payload
         * and a couple of cover reloads, small enough that a wedged helper cannot balloon memory.
         */
        private const val WRITE_QUEUE_CAPACITY = 256

        /** Poison pill: flushes whatever precedes it, then ends the stdin writer thread. */
        private const val WRITER_POISON = "__spw-folia-writer-poison__"

        /** Track/lyrics are polled every 200 ms (they are cheap cached JSON diffs); the provider
         *  itself throttles the Workshop API round-trip, see FoliaPlaybackExtension. */
        private const val TRACK_CHECK_EVERY_TICKS = 2L
        private const val SETTINGS_ENTRY = "settings-ui.js"
        private const val DEV_ROOT = "D:/输出目录/dsh2"
    }
}
