package dev.spw.folia

import java.util.concurrent.atomic.AtomicReference

// -----------------------------------------------------------------------------
// spw-folia: smooth playback clock for the WebView lyric/visualizer page.
// Clean-room Kotlin/JVM (pure stdlib, no coroutines, no Android/Workshop API deps).
// Drop this single file into spw-folia/src/main/kotlin/dev/spw/folia/ and wire the
// Workshop PlaybackExtensionPoint callbacks through WorkshopPlaybackCallbacks.
// Integration + measured accuracy: docs/audio-timeline.md.
// -----------------------------------------------------------------------------


/**
 * Playback status as reported by the SPW Workshop API (`PlaybackExtensionPoint.onStateChanged`).
 */
enum class PlaybackState { IDLE, BUFFERING, READY, ENDED }

/** Where the value returned by [PlaybackTimeline.currentTimeMs] comes from. */
enum class TimeSource {
    /** Extrapolated from the last 1 Hz position update plus monotonic clock. */
    INTERPOLATED,
    /** Frozen at an anchor: paused, buffering, ended, or not playing yet. */
    ANCHORED,
}

data class TimelineSnapshot(
    val positionMs: Double,
    val durationMs: Long,
    val playing: Boolean,
    val buffering: Boolean,
    val ended: Boolean,
    val rate: Double,
    val seekPending: Boolean,
    val source: TimeSource,
)

/**
 * Turns the Workshop API's ~1 Hz `onPositionUpdated` callbacks into a smooth 30-60 Hz playback
 * clock using a monotonic clock (`System.nanoTime` by default).
 *
 * Why this is needed: the host service updates plugin extensions once per second
 * (`PlaybackService.updateProgress` loop: `updateProgress(0,0)` + `delay(1000)`), which is far too
 * coarse for lyrics scroll / visualizer synchronization. The alternative - reading the host's
 * player object directly at 30-60 Hz - is described in `docs/audio-timeline.md` (`HostPlaybackProbe`)
 * but depends on obfuscated internals; this class is the safe, API-only path.
 *
 * Behavior contract:
 *  - **Playing**: `position = anchor + (now - anchorTime) * rate`, capped at
 *    [Config.maxExtrapolationMs] past the last update so a stalled feed cannot run away.
 *  - **Paused / buffering / ended**: time freezes at the anchor.
 *  - **Seek**: [onSeekTo] anchors optimistically at the target, then accepts the first position
 *    update within [Config.seekToleranceMs] of it (or after [Config.seekAckWindowMs]); stale
 *    updates from the pre-seek position are ignored instead of yanking the clock backwards.
 *  - **Drift**: each 1 Hz update is compared with the extrapolated value. Small residual: snap to
 *    the truth. Medium residual (120..800 ms): apply a partial correction so the UI moves
 *    smoothly. Large residual (>800 ms): hard snap (external seek/rate change/track edit).
 *  - **Rate**: learned from consecutive updates (`Δposition / ΔwallTime`) with EMA smoothing;
 *    explicit [onPlaybackRateChanged] wins until the next learning cycle.
 *  - All public methods are thread-safe and may be called from the Workshop callback thread while
 *    the render thread reads [currentTimeMs].
 *
 * The clock is injectable for deterministic tests.
 */
class PlaybackTimeline(
    private val clockNanos: () -> Long = { System.nanoTime() },
    private val config: Config = Config(),
) {
    data class Config(
        /** Fallback playback rate before any learning/observation. */
        val defaultRate: Double = 1.0,
        /** How long a seek waits for an authoritative position update before trusting updates again. */
        val seekAckWindowMs: Long = 2500,
        /** A position update within this distance of the seek target acknowledges the seek. */
        val seekToleranceMs: Double = 1500.0,
        /** Extra time to run past the last position update while playing. */
        val maxExtrapolationMs: Double = 2500.0,
        /** Residual above which the clock snaps immediately instead of drifting smoothly. */
        val hardDriftMs: Double = 800.0,
        /** Residual below which the clock snaps immediately (normal extrapolation error). */
        val softDriftMs: Double = 120.0,
        /** Fraction of a medium residual corrected per update (0 = ignore, 1 = full snap). */
        val softCorrectionGain: Double = 0.25,
        /** Learn playback rate from observed position deltas. */
        val rateLearning: Boolean = true,
        val minRate: Double = 0.25,
        val maxRate: Double = 4.0,
        /** EMA weight of a new rate observation. */
        val rateSmoothing: Double = 0.3,
        /** Ignore observations over spans shorter/longer than these (pause/seek/noise guards). */
        val rateMinSpanMs: Long = 300,
        val rateMaxSpanMs: Long = 5000,
        /** Observed rate must be at least this far from 1.0 to be treated as a real rate change. */
        val rateNoOpBand: Double = 0.005,
        val residualHistory: Int = 128,
    )

    /** Cumulative diagnostics; useful for tests and for the plugin's debug panel. */
    data class Stats(
        val updates: Long,
        val seeks: Long,
        val seeksAcked: Long,
        val seeksTimedOut: Long,
        val hardSnaps: Long,
        val softCorrections: Long,
        val rateObservations: Long,
        val rateChanges: Long,
        val staleUpdatesIgnored: Long,
        val meanAbsResidualMs: Double,
        val p95AbsResidualMs: Double,
        val maxAbsResidualMs: Double,
        val lastResidualMs: Double,
        val rate: Double,
    )

    private val lock = Any()
    private var anchorPosMs = 0.0
    private var anchorNanos = clockNanos()
    private var playing = false
    private var buffering = false
    private var ended = false
    private var durationMs = 0L
    private var rate = config.defaultRate
    private var anchorRate = config.defaultRate

    private var lastUpdatePosMs = Double.NaN
    private var lastUpdateNanos = 0L
    private var lastUpdateWasPlaying = false

    private var pendingSeekTargetMs = Double.NaN
    private var pendingSeekOldPosMs = Double.NaN
    private var pendingSeekDeadlineNanos = 0L

    private val residuals = ArrayDeque<Double>()
    private var updates = 0L
    private var seeks = 0L
    private var seeksAcked = 0L
    private var seeksTimedOut = 0L
    private var hardSnaps = 0L
    private var softCorrections = 0L
    private var rateObservations = 0L
    private var rateChanges = 0L
    private var staleUpdatesIgnored = 0L
    private var lastResidualMs = 0.0

    // ---------------------------------------------------------------- inputs

    /** Called from `PlaybackExtensionPoint.onPositionUpdated` (1 Hz, milliseconds). */
    fun onPositionUpdated(positionMs: Long) {
        val now = clockNanos()
        val pos = positionMs.toDouble()
        synchronized(lock) {
            updates++
            val target = pendingSeekTargetMs
            if (!target.isNaN()) {
                val acked = Math.abs(pos - target) <= config.seekToleranceMs
                val timedOut = now - pendingSeekDeadlineNanos >= 0
                when {
                    acked -> {
                        seeksAcked++
                        clearPendingSeek()
                        reanchor(pos, now)
                        rememberUpdate(pos, now)
                    }
                    timedOut -> {
                        seeksTimedOut++
                        clearPendingSeek()
                        reanchor(pos, now)
                        rememberUpdate(pos, now)
                    }
                    // Stale update from before the seek: keep the optimistic target anchor.
                    Math.abs(pos - pendingSeekOldPosMs) <= config.hardDriftMs -> {
                        staleUpdatesIgnored++
                        rememberUpdate(pos, now)
                    }
                    // Update is neither old nor target: the seek landed somewhere else; accept it.
                    else -> {
                        seeksTimedOut++
                        clearPendingSeek()
                        reanchor(pos, now)
                        rememberUpdate(pos, now)
                    }
                }
                return
            }

            if (playing && !buffering && !ended && !lastUpdatePosMs.isNaN()) {
                val predicted = extrapolate(now)
                val residual = pos - predicted
                lastResidualMs = residual
                recordResidual(residual)
                learnRate(pos, now)
                when {
                    Math.abs(residual) > config.hardDriftMs -> {
                        hardSnaps++
                        reanchor(pos, now)
                    }
                    Math.abs(residual) > config.softDriftMs -> {
                        softCorrections++
                        // Move part of the way toward the truth without a visible jump.
                        reanchor(predicted + residual * config.softCorrectionGain, now)
                    }
                    else -> reanchor(pos, now)
                }
            } else {
                reanchor(pos, now)
            }
            rememberUpdate(pos, now)
        }
    }

    /** Called from `PlaybackExtensionPoint.onIsPlayingChanged`. */
    fun onIsPlayingChanged(isPlaying: Boolean) {
        val now = clockNanos()
        synchronized(lock) {
            if (isPlaying == playing) return
            if (isPlaying) {
                // Resume from wherever the frozen clock was.
                reanchor(currentTimeLocked(now), now)
                playing = true
                if (durationMs > 0 && anchorPosMs < durationMs - 250.0) ended = false
            } else {
                reanchor(currentTimeLocked(now), now)
                playing = false
            }
            resetRateSpan()
        }
    }

    /** Called from `PlaybackExtensionPoint.onStateChanged`. */
    fun onStateChanged(state: PlaybackState) {
        val now = clockNanos()
        synchronized(lock) {
            when (state) {
                PlaybackState.IDLE -> {
                    clearPendingSeek()
                    playing = false
                    buffering = false
                    ended = false
                    durationMs = 0L
                    reanchor(0.0, now)
                    resetRateSpan()
                }
                PlaybackState.BUFFERING -> {
                    if (!buffering) reanchor(currentTimeLocked(now), now)
                    buffering = true
                    resetRateSpan()
                }
                PlaybackState.READY -> {
                    if (buffering) reanchor(currentTimeLocked(now), now)
                    buffering = false
                    ended = false
                    resetRateSpan()
                }
                PlaybackState.ENDED -> {
                    if (durationMs > 0) reanchor(durationMs.toDouble(), now) else reanchor(currentTimeLocked(now), now)
                    ended = true
                    playing = false
                    resetRateSpan()
                }
            }
        }
    }

    /** Called from `PlaybackExtensionPoint.onSeekTo`; `targetMs` may be clamped by the host later. */
    fun onSeekTo(targetMs: Long) {
        val now = clockNanos()
        synchronized(lock) {
            seeks++
            val target = clampToTrack(targetMs.toDouble())
            pendingSeekOldPosMs = currentTimeLocked(now)
            pendingSeekTargetMs = target
            pendingSeekDeadlineNanos = now + config.seekAckWindowMs * 1_000_000L
            ended = false
            reanchor(target, now)
            resetRateSpan()
        }
    }

    /** Explicit speed change (e.g. plugin setting); otherwise rate is learned from updates. */
    fun onPlaybackRateChanged(newRate: Double) {
        val now = clockNanos()
        synchronized(lock) {
            val r = newRate.coerceIn(config.minRate, config.maxRate)
            if (Math.abs(r - rate) < 1e-9) return
            reanchor(currentTimeLocked(now), now)
            rate = r
            anchorRate = r
            rateChanges++
            resetRateSpan()
        }
    }

    /** New track / new duration; `startPositionMs` defaults to 0. */
    fun onTrackChanged(durationMs: Long, startPositionMs: Long = 0L) {
        val now = clockNanos()
        synchronized(lock) {
            clearPendingSeek()
            this.durationMs = if (durationMs > 0) durationMs else 0L
            rate = config.defaultRate
            anchorRate = config.defaultRate
            ended = false
            reanchor(clampToTrack(startPositionMs.toDouble()), now)
            resetRateSpan()
        }
    }

    // ---------------------------------------------------------------- outputs

    /** Smooth current playback position in milliseconds. Thread-safe. */
    fun currentTimeMs(): Double = synchronized(lock) { currentTimeLocked(clockNanos()) }

    fun snapshot(): TimelineSnapshot = synchronized(lock) {
        val now = clockNanos()
        TimelineSnapshot(
            positionMs = currentTimeLocked(now),
            durationMs = durationMs,
            playing = playing,
            buffering = buffering,
            ended = ended,
            rate = rate,
            seekPending = !pendingSeekTargetMs.isNaN(),
            source = if (playing && !buffering && !ended) TimeSource.INTERPOLATED else TimeSource.ANCHORED,
        )
    }

    fun stats(): Stats = synchronized(lock) {
        val abs = residuals.map { Math.abs(it) }
        val sorted = abs.sorted()
        Stats(
            updates = updates,
            seeks = seeks,
            seeksAcked = seeksAcked,
            seeksTimedOut = seeksTimedOut,
            hardSnaps = hardSnaps,
            softCorrections = softCorrections,
            rateObservations = rateObservations,
            rateChanges = rateChanges,
            staleUpdatesIgnored = staleUpdatesIgnored,
            meanAbsResidualMs = if (abs.isEmpty()) 0.0 else abs.average(),
            p95AbsResidualMs = if (sorted.isEmpty()) 0.0 else sorted[Math.min(sorted.size - 1, (sorted.size * 95) / 100)],
            maxAbsResidualMs = if (sorted.isEmpty()) 0.0 else sorted.last(),
            lastResidualMs = lastResidualMs,
            rate = rate,
        )
    }

    /** Reset all state (plugin reload / helper restart). */
    fun reset() {
        val now = clockNanos()
        synchronized(lock) {
            anchorPosMs = 0.0
            anchorNanos = now
            playing = false
            buffering = false
            ended = false
            durationMs = 0L
            rate = config.defaultRate
            anchorRate = config.defaultRate
            lastUpdatePosMs = Double.NaN
            lastUpdateNanos = 0L
            lastUpdateWasPlaying = false
            clearPendingSeek()
            residuals.clear()
            updates = 0; seeks = 0; seeksAcked = 0; seeksTimedOut = 0
            hardSnaps = 0; softCorrections = 0; rateObservations = 0; rateChanges = 0
            staleUpdatesIgnored = 0; lastResidualMs = 0.0
        }
    }

    // ---------------------------------------------------------------- internals

    /** Position at `now` assuming uninterrupted interpolation since the anchor. Caller holds lock. */
    private fun currentTimeLocked(now: Long): Double {
        if (!playing || buffering || ended) return clampToTrack(anchorPosMs)
        return clampToTrack(extrapolate(now))
    }

    private fun extrapolate(now: Long): Double {
        val elapsedMs = (now - anchorNanos) / 1_000_000.0
        val dt = elapsedMs.coerceIn(0.0, config.maxExtrapolationMs)
        var pos = anchorPosMs + dt * anchorRate
        // While a seek is in flight, never run past the requested target.
        val target = pendingSeekTargetMs
        if (!target.isNaN() && pos > target) pos = target
        return pos
    }

    private fun reanchor(positionMs: Double, now: Long) {
        anchorPosMs = clampToTrack(positionMs)
        anchorNanos = now
    }

    private fun rememberUpdate(pos: Double, now: Long) {
        lastUpdatePosMs = pos
        lastUpdateNanos = now
        lastUpdateWasPlaying = playing && !buffering && !ended
    }

    private fun resetRateSpan() {
        lastUpdatePosMs = Double.NaN
        lastUpdateNanos = 0L
        lastUpdateWasPlaying = false
    }

    private fun clearPendingSeek() {
        pendingSeekTargetMs = Double.NaN
        pendingSeekOldPosMs = Double.NaN
        pendingSeekDeadlineNanos = 0L
    }

    private fun clampToTrack(positionMs: Double): Double {
        var pos = positionMs.coerceAtLeast(0.0)
        if (durationMs > 0) pos = pos.coerceAtMost(durationMs.toDouble())
        return pos
    }

    private fun recordResidual(residualMs: Double) {
        residuals.addLast(residualMs)
        while (residuals.size > config.residualHistory) residuals.removeFirst()
    }

    /**
     * Learn rate from the two most recent raw position updates. Only observations taken while
     * continuously playing and spanning [Config.rateMinSpanMs]..[Config.rateMaxSpanMs] are used.
     */
    private fun learnRate(pos: Double, now: Long) {
        if (!config.rateLearning) {
            resetRateSpan()
            return
        }
        if (lastUpdatePosMs.isNaN() || !lastUpdateWasPlaying) {
            // No usable previous sample: the pair is reset after this update.
            lastUpdatePosMs = pos
            lastUpdateNanos = now
            lastUpdateWasPlaying = playing && !buffering && !ended
            return
        }
        val spanMs = (now - lastUpdateNanos) / 1_000_000.0
        if (spanMs < config.rateMinSpanMs || spanMs > config.rateMaxSpanMs) return
        val observed = (pos - lastUpdatePosMs) / spanMs
        if (observed < config.minRate || observed > config.maxRate) return
        rateObservations++
        val nearOne = Math.abs(observed - rate) <= config.rateNoOpBand
        if (!nearOne) {
            val blended = rate * (1.0 - config.rateSmoothing) + observed * config.rateSmoothing
            val next = blended.coerceIn(config.minRate, config.maxRate)
            if (Math.abs(next - rate) > config.rateNoOpBand) {
                rate = next
                anchorRate = next
                rateChanges++
            }
        }
        // Interpolation continues from the authoritative update anchored by the caller.
        lastUpdatePosMs = pos
        lastUpdateNanos = now
        lastUpdateWasPlaying = playing && !buffering && !ended
    }
}

// --- TimelineController: plugin-facing wrapper ---------------------------------



/**
 * Callback surface of the parts of SPW Workshop `PlaybackExtensionPoint` (1.19.0) that drive the
 * timeline. The plugin implements this by delegating its `PlaybackExtensionPoint` overrides; the
 * durations/seek-targets are passed through unchanged.
 *
 * Kept as a local interface (instead of depending on the Workshop API jar) so the timeline module
 * compiles and unit-tests as plain JVM code and the Lead can wire it inside the real plugin.
 */
interface WorkshopPlaybackCallbacks {
    /** `PlaybackExtensionPoint.onPositionUpdated(position: Long)` - about 1 Hz. */
    fun onPositionUpdated(position: Long)

    /** `PlaybackExtensionPoint.onIsPlayingChanged(isPlaying: Boolean)`. */
    fun onIsPlayingChanged(isPlaying: Boolean)

    /** `PlaybackExtensionPoint.onStateChanged(state: State)`; map host states to [PlaybackState]. */
    fun onStateChanged(state: PlaybackState)

    /** `PlaybackExtensionPoint.onSeekTo(position: Long)`. */
    fun onSeekTo(position: Long)

    /** Not a Workshop callback: call when the plugin learns the track duration (MediaItem.duration). */
    fun onDurationChanged(durationMs: Long)

    /** Not a Workshop callback: call when the track changes (`onBeforeLoadLyrics`/`onAfterLoadLyrics`). */
    fun onTrackChanged(durationMs: Long, startPositionMs: Long)
}

/**
 * Plugin-facing wrapper: owns a [PlaybackTimeline], implements [WorkshopPlaybackCallbacks], and
 * exposes the interpolated clock together with the last snapshot for the webview bridge.
 *
 * Wiring inside the real plugin:
 * ```
 * class SpwFoliaPlaybackExtension : PlaybackExtensionPoint {
 *     private val controller = TimelineController()
 *     override fun onPositionUpdated(position: Long) = controller.onPositionUpdated(position)
 *     override fun onIsPlayingChanged(isPlaying: Boolean) = controller.onIsPlayingChanged(isPlaying)
 *     override fun onStateChanged(state: State) = controller.onStateChanged(map(state))
 *     override fun onSeekTo(position: Long) = controller.onSeekTo(position)
 *     fun onMediaItemChanged(item: MediaItem?) = controller.onDurationChanged(item?.duration ?: 0)
 * }
 * // 30-60 Hz push loop (or poll on each webview frame):
 * bridge.post(controller.snapshotJson(nowMs()))
 * ```
 *
 * The optional [hostClock] hook lets the Lead swap in `HostPlaybackProbe` (see `docs/audio-timeline.md`):
 * when it returns a non-null position the timeline re-anchors to it instead of extrapolating; this
 * is the path to true 30-60 Hz position once the probe is validated on the real host.
 */
class TimelineController(
    private val timeline: PlaybackTimeline = PlaybackTimeline(),
    /** Optional high-rate position source (HostPlaybackProbe). Return null when unavailable. */
    private val hostClock: (() -> Long?)? = null,
) : WorkshopPlaybackCallbacks {

    private val lastSnapshot = AtomicReference<TimelineSnapshot?>(null)
    private val lastHostAnchorNanos = AtomicReference(0L)

    override fun onPositionUpdated(position: Long) {
        timeline.onPositionUpdated(position)
        lastSnapshot.set(timeline.snapshot())
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        timeline.onIsPlayingChanged(isPlaying)
        lastSnapshot.set(timeline.snapshot())
    }

    override fun onStateChanged(state: PlaybackState) {
        timeline.onStateChanged(state)
        lastSnapshot.set(timeline.snapshot())
    }

    override fun onSeekTo(position: Long) {
        timeline.onSeekTo(position)
        lastSnapshot.set(timeline.snapshot())
    }

    override fun onDurationChanged(durationMs: Long) {
        // Keep the current position; only the track length changes.
        timeline.onTrackChanged(durationMs, timeline.currentTimeMs().toLong())
        lastSnapshot.set(timeline.snapshot())
    }

    override fun onTrackChanged(durationMs: Long, startPositionMs: Long) {
        timeline.onTrackChanged(durationMs, startPositionMs)
        lastSnapshot.set(timeline.snapshot())
    }

    fun onPlaybackRateChanged(rate: Double) {
        timeline.onPlaybackRateChanged(rate)
        lastSnapshot.set(timeline.snapshot())
    }

    /**
     * Smooth position used for lyric sync (ms). Polled by the webview bridge at frame rate.
     *
     * When a [hostClock] is configured it is used as a *correction* only: a direct host position is
     * authoritative, but hard-anchoring the timeline on every poll can produce backward steps when
     * the host's own 1 Hz update lands; instead the host reading is fed through the same 1 Hz
     * correction path at a bounded cadence (100 ms) so the timeline keeps its interpolation and
     * only slowly aligns to the host. This keeps the output monotonic in the common case.
     */
    fun positionMs(): Double {
        val host = hostClock
        if (host != null) {
            val now = System.nanoTime()
            val last = lastHostAnchorNanos.get()
            if (now - last >= HOST_CLOCK_MIN_INTERVAL_NANOS) {
                lastHostAnchorNanos.set(now)
                val direct = host()
                if (direct != null && direct >= 0) timeline.onPositionUpdated(direct)
            }
        }
        return timeline.currentTimeMs()
    }

    fun snapshot(): TimelineSnapshot =
        lastSnapshot.get() ?: timeline.snapshot().also { lastSnapshot.set(it) }

    fun stats(): PlaybackTimeline.Stats = timeline.stats()

    fun timeline(): PlaybackTimeline = timeline

    private companion object {
        /** Minimum spacing between direct host-position corrections (100 ms / 10 Hz). */
        const val HOST_CLOCK_MIN_INTERVAL_NANOS = 100_000_000L
    }
}
