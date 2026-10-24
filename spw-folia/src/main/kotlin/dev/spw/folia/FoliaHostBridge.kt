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
 *    {"t":"lyrics"...}, {"t":"track"...}, {"t":"queue"...} (v0.3.0), {"t":"quit"}
 *  - helper -> plugin (stdout): {"t":"ready"...}, {"t":"closed","reason":...},
 *    {"t":"settings","settings":{...}}, {"t":"action"...}, {"t":"control"...} (v0.3.0),
 *    {"t":"log"...}
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
     *
     * v0.2.0: the queue belongs to one helper session (re-created by `startStdinWriter`). A window
     * can be closed (ESC / 更多 -> Folia toggled) without the plugin being disabled, so the bridge
     * is re-opened on the same instance: a writer of a previous session may still be parked in
     * `take()`. It is interrupted before the new queue is published, and its `finally` may only
     * touch the session it owns - otherwise a stale writer could wipe the *new* queue or mark the
     * new pipe `stdinBroken` after writing the old, closed process, silently muting the second window.
     */
    @Volatile private var pendingLines: LinkedBlockingQueue<String>? = null
    private val stdoutLogLock = Any()
    @Volatile private var writerThread: Thread? = null
    @Volatile private var stdinBroken = false

    @Volatile private var pid: Long = -1L

    /** Opaque Folia settings tree (canonical JSON), updated from the page via stdout `settings`. */
    @Volatile var settingsTree: String? = null

    /**
     * Host version reported in the `hello` line. Set by [FoliaPlugin.start] to the *running* SPW
     * version (1.19.2, 1.20.x, …); the compile-time constant is only a placeholder so the helper
     * still gets a well-formed handshake when the plugin is driven by tests.
     */
    @Volatile var hostVersion: String = FoliaPlugin.SPW_VERSION

    /** Called when the helper reports `closed` (window closed by user/helper); plugin stays loaded. */
    @Volatile var onClosed: ((String) -> Unit)? = null

    /** Called with the raw settings JSON whenever the page sends an updated tree. */
    @Volatile var onSettingsFromPage: ((String) -> Unit)? = null

    // Providers installed by FoliaPlugin; polled by the state pump.
    @Volatile var snapshotProvider: (() -> PlaybackSnapshot?)? = null
    @Volatile var lyricsProvider: (() -> String?)? = null
    @Volatile var trackProvider: (() -> String?)? = null

    /**
     * v0.3.0: playback queue snapshot (`{"mode":...,"random":...,"index":...,"items":[...]}`),
     * polled every 500 ms and diffed before sending. Null when the host player is not reachable.
     */
    @Volatile var queueProvider: (() -> String?)? = null

    private val lastSentTrack = AtomicReference<String?>(null)

    /** v0.3.0: last queue body sent to the helper; the pump only re-sends on change. */
    private val lastSentQueue = AtomicReference<String?>(null)

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
        val exe = resolveHelper()?.let { physicalFile(it) }
        if (exe == null) {
            log("host helper not found (looked in pluginPath/host and dev checkout)")
            return false
        }
        val web = resolveWebDir()?.let { physicalFile(it) }
        if (web == null) {
            log("web bundle not found (looked in pluginPath/web and dev checkout)")
            return false
        }
        // The helper is a .NET Framework 4.8 executable: its loader reads <exe>.config *before*
        // managed code runs, and it does so with paths the MSIX filesystem redirection does not
        // cover (see physicalFile()). Warn once here so the failure is diagnosable from the log.
        if (!File(exe.parentFile, exe.name + ".config").isFile) {
            log("helper .config not reachable at ${File(exe.parentFile, exe.name + ".config")}; " +
                "CLR activation will likely fail with 0x80131700 (MSIX virtual path?)")
        }
        val command = mutableListOf(
            exe.absolutePath,
            "--bundle", web.absolutePath,
            "--fullscreen",
            "--bundle-version", FoliaPlugin.PLUGIN_VERSION
        )
        val settingsDir = resolveSettingsDir(web)?.let { physicalFile(it) }
        if (settingsDir != null) {
            command += listOf("--settings-dir", settingsDir.absolutePath, "--settings-entry", SETTINGS_ENTRY)
        }
        // cwd = plugin dir so every relative path inside the helper resolves against the install
        // location; all paths we pass are absolute anyway (cwd is only a safety net).
        val workDir = physicalFile(pluginPath.absoluteFile).also { it.mkdirs() }
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
        lastSentQueue.set(null)
        startStdoutReader(p)
        startExitWatcher(p)
        startStdinWriter(p)
        sendLine(
            "{\"t\":\"hello\",\"protocol\":1,\"pluginVersion\":${Json.str(FoliaPlugin.PLUGIN_VERSION)}," +
                "\"spwVersion\":${Json.str(hostVersion)},\"bundleDir\":${Json.str(web.absolutePath)}}"
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
        cleanup("stopped", p)
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

    fun sendQueue(queueJson: String) {
        lastSentQueue.set(queueJson)
        // Same shape as `track` (protocol v1): the queue object's fields sit at the top level.
        val body = queueJson.trim().removePrefix("{").removeSuffix("}")
        sendLine("{\"t\":\"queue\",$body}")
    }

    /**
     * v0.3.0: pushes the queue only when it changed (or [force]); returns true when a line went
     * out. The provider is the reflection layer and already swallows/logs its own failures, so a
     * transient null simply keeps the page's last snapshot.
     */
    private fun maybeSendQueue(force: Boolean = false): Boolean {
        val queue = queueProvider?.invoke() ?: return false
        if (!force && queue == lastSentQueue.get()) return false
        log("queue -> helper (${queue.length} bytes${if (force) ", force" else ""})")
        sendQueue(queue)
        return true
    }

    private fun sendLine(line: String) {
        val queue = pendingLines ?: return
        if (stdinBroken || writerThread == null) return
        // Bounded by design: when the helper stops draining the pipe we must not pile up track
        // payloads unbounded. Drop the oldest buffered line - under normal load the dropped lines
        // are idempotent state (100 ms `state` cadence, lyrics/track snapshots), so the freshest
        // line wins. Quit/poison are only enqueued after the pump stops and never become the oldest
        // entry; in a degenerate sustained overflow `settings` may be the one dropped as well (a
        // reopened window re-sends settings). Note the bound is a line count, not bytes: a track
        // line can reach ~213 KB (cover <=160,000 B -> base64), so the theoretical worst case is
        // tens of MB, but only after seconds of the helper not reading at all.
        while (!queue.offer(line)) {
            val dropped = queue.poll()
            if (dropped != null && dropped != WRITER_POISON) {
                val count = droppedLines.incrementAndGet()
                if (count <= 3L || count % 100L == 0L) {
                    log("stdin queue overflow, dropping buffered line #$count")
                }
            }
        }
    }

    /** The single owner of one helper session's stdin. Any failure marks that pipe dead. */
    private fun startStdinWriter(p: Process) {
        // A previous session's writer may still be parked in take(); retire it before publishing
        // the new queue so it can never consume (or poison) the new session's lines (v0.2.0).
        stopStdinWriter()

        val queue = LinkedBlockingQueue<String>(WRITE_QUEUE_CAPACITY)
        // F5: if the helper dies right after spawn, constructing the pipe writer can throw. Fail the
        // session gracefully (the exit watcher will still clean up) instead of propagating out of
        // open() with a half-initialised bridge.
        val out = try {
            BufferedWriter(OutputStreamWriter(p.outputStream, StandardCharsets.UTF_8))
        } catch (t: Throwable) {
            log("stdin writer setup failed: ${t::class.java.name}: ${t.message}")
            return
        }
        val thread = Thread({
            try {
                while (true) {
                    val line = queue.take()
                    if (line == WRITER_POISON) break
                    out.write(line)
                    out.write("\n")
                    out.flush()
                }
            } catch (t: Throwable) {
                if (!stopping && writerThread === Thread.currentThread()) {
                    log("stdin writer stopped: ${t::class.java.name}: ${t.message}")
                }
            } finally {
                // Only the current session's writer may poison shared state (v0.2.0): a stale writer
                // from a closed window must not clear the new queue or mark the new pipe broken.
                if (writerThread === Thread.currentThread()) {
                    stdinBroken = true
                    queue.clear()
                }
                try {
                    out.flush()
                    out.close()
                } catch (_: Throwable) {
                }
            }
        }, "spw-folia-host-stdin").apply { isDaemon = true }
        pendingLines = queue
        stdinBroken = false
        writerThread = thread
        thread.start()
    }

    /**
     * Retires the current session's writer: invalidate it first (so its `finally` becomes a no-op),
     * then unblock a thread parked in `take()`. Used by cleanup and before each new session.
     */
    private fun stopStdinWriter() {
        val old = writerThread
        writerThread = null
        pendingLines = null
        stdinBroken = true
        old?.interrupt()
        if (old != null && old !== Thread.currentThread()) {
            try {
                old.join(500)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
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
                    handleHostLine(line, p)
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
                cleanup("exited", p)
            }
        }, "spw-folia-host-exit").apply { isDaemon = true }.start()
    }

    private fun handleHostLine(line: String, source: Process) {
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
                // Stale `closed` from a previous session must not close the new window (F1).
                if (cleanup(reason, source)) onClosed?.invoke(reason)
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
            "control" -> {
                // v0.3.0 playback-bar control from the page. Reflection failures are swallowed by
                // FoliaPlaybackControls; this catch is the last line of defence for the reader thread.
                try {
                    FoliaPlaybackControls.handleControl(line)
                } catch (t: Throwable) {
                    log("control handling failed: ${t::class.java.name}: ${t.message}")
                }
            }
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

    /**
     * Tears down the current host session. `expected` is the process the caller owns: a cleanup that
     * arrives late from a previous session's exit watcher / stdout reader must never tear down a
     * newer session (F1), so it returns without touching state. Holding the lifecycle monitor makes
     * cleanup atomic with respect to open()/stop() (F2); both already hold it, so nested calls are
     * re-entrant. Returns true when this call actually cleaned the current session.
     */
    @Synchronized
    private fun cleanup(reason: String, expected: Process? = null): Boolean {
        if (expected != null && process !== expected) {
            log("host cleanup ($reason) ignored: stale session")
            return false
        }
        stopPump()
        // Retire the writer before the process reference disappears: this marks the pipe dead (so
        // the pump stops queueing) and unblocks a writer parked in take() (v0.2.0).
        stopStdinWriter()
        val dropped = droppedLines.getAndSet(0L)
        if (dropped > 0L) log("host cleanup ($reason): $dropped stdin lines were dropped by queue overflow during this session")
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
        return true
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
        // v0.3.0: queue after state/track/lyrics so a re-opened window shows the list immediately.
        runCatching { maybeSendQueue(force = true) }
            .onFailure { log("replay queue failed: ${it::class.java.name}: ${it.message}") }
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
                // v0.3.0 queue/mode snapshot: low-frequency diff (500 ms), force-pushed on the
                // tick after a control so shuffle state / the highlighted item update at once.
                val forceQueue = FoliaPlaybackControls.consumeQueueDirty()
                if (forceQueue || pumpTicks % QUEUE_CHECK_EVERY_TICKS == 0L) {
                    maybeSendQueue(force = forceQueue)
                }
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

    /**
     * Returns the *physical* (non-virtualized) form of [file].
     *
     * Why this exists: on the Microsoft Store channel (MSIX) SPW runs packaged, so `pluginPath`
     * is a virtual path (`C:\Users\<u>\AppData\Roaming\Salt Player for Windows\...`) that only
     * resolves for processes carrying the package identity — the real bits live under
     * `%LOCALAPPDATA%\Packages\<pkg>\LocalCache\Roaming\...`.
     *
     * `spw-folia-host.exe` is a .NET Framework 4.8 executable. Its loader (mscoree) opens
     * `<exe>.config` during CLR activation using native NT paths that the MSIX filesystem
     * redirection does **not** cover, so it gets `ERROR_PATH_NOT_FOUND` (0x80070003), concludes
     * "Unable to find a version of the runtime to use" and aborts with exit code
     * **-2146232576 / 0x80131700 (CLR_E_SHIM_RUNTIMELOAD)**, which the user sees as the
     * "This application could not be started" dialog. Managed code never runs, so the helper's
     * own stdout/stderr stay empty.
     *
     * Fix: pass the helper physical paths. Two steps, cheapest first:
     *  1. `toRealPath()` / `canonicalFile` — resolves symlinks, junctions and (on MSIX) the
     *     package's AppData redirection, because the handle is opened on the real file.
     *  2. MSIX fallback: mirror `...\AppData\Roaming\<rest>` into
     *     `%LOCALAPPDATA%\Packages\*\LocalCache\Roaming\<rest>`, which is where Store apps
     *     actually keep the data.
     */
    private fun physicalFile(file: File): File {
        val abs = file.absoluteFile
        val resolved = runCatching { abs.toPath().toRealPath().toFile() }.getOrNull()
            ?: runCatching { abs.canonicalFile }.getOrNull()
            ?: abs
        val out = msixPhysicalPath(resolved) ?: msixPhysicalPath(abs) ?: resolved
        if (!out.path.equals(abs.path, ignoreCase = true)) {
            log("physical path: ${abs.path} -> ${out.path}")
        }
        return out
    }

    /**
     * MSIX fallback: re-maps an `AppData\Roaming` path onto the package's real `LocalCache`
     * location. Returns null when the input is not an AppData\Roaming path or when no
     * installed package holds it (e.g. the non-Store channel, where the path is already real).
     */
    private fun msixPhysicalPath(file: File): File? {
        val roaming = System.getenv("APPDATA")?.takeIf { it.isNotBlank() } ?: return null
        val localAppData = System.getenv("LOCALAPPDATA")?.takeIf { it.isNotBlank() } ?: return null
        val path = file.path
        if (!path.startsWith(roaming, ignoreCase = true)) return null
        val rest = path.substring(roaming.length).trimStart('\\', '/')
        if (rest.isEmpty()) return null
        val packages = File(localAppData, "Packages")
        val dirs = runCatching { packages.listFiles() }.getOrNull() ?: return null
        return dirs.firstNotNullOfOrNull { pkg ->
            File(pkg, "LocalCache/Roaming/$rest").takeIf { it.exists() }
        }
    }

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
        return candidates.firstOrNull { it.isFile }
    }

    private fun resolveWebDir(): File? {
        val candidates = mutableListOf<File>()
        System.getenv("SPW_FOLIA_WEB")?.takeIf { it.isNotBlank() }?.let { candidates += File(it) }
        candidates += File(pluginPath, "web")
        candidates += File(pluginPath, "web/dist")
        return candidates.firstOrNull { File(it, "index.html").isFile }
    }

    private fun resolveSettingsDir(web: File): File? {
        // Packaged layout: <bundle>/settings/settings-ui.js is auto-detected by the helper, so
        // no flag is needed there. Only pass explicit flags when the file lives elsewhere.
        if (File(web, "settings/$SETTINGS_ENTRY").isFile) return null
        val candidates = mutableListOf<File>()
        System.getenv("SPW_FOLIA_SETTINGS")?.takeIf { it.isNotBlank() }?.let { candidates += File(it) }
        candidates += File(pluginPath, "web/settings")
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

        /** v0.3.0: queue is diffed every 500 ms; controls force an immediate push via queueDirty. */
        private const val QUEUE_CHECK_EVERY_TICKS = 5L
        private const val SETTINGS_ENTRY = "settings-ui.js"
    }
}
