package dev.spw.folia

import kotlin.math.abs

/**
 * Deterministic test harness for [PlaybackTimeline].
 *
 * Simulates the Workshop API's ~1 Hz `onPositionUpdated` feed with a virtual clock, samples the
 * interpolated clock at 60 Hz and measures the error against the ground-truth playback position.
 * No JUnit: plain `main` + assertions so it runs with `java -cp ... dev.spw.folia.PlaybackTimelineTest`.
 */
object PlaybackTimelineTest {
    private var failures = 0
    private var checks = 0

    private fun check(name: String, ok: Boolean, detail: String = "") {
        checks++
        if (!ok) {
            failures++
            println("FAIL  $name ${if (detail.isEmpty()) "" else "($detail)"}")
        } else {
            println("ok    $name${if (detail.isEmpty()) "" else " ($detail)"}")
        }
    }

    private fun near(name: String, actual: Double, expected: Double, tol: Double) {
        check(name, abs(actual - expected) <= tol, "actual=%.3f expected=%.3f tol=%.1f".format(actual, expected, tol))
    }

    /** Virtual clock, advanced explicitly by the simulated host/UI threads. */
    private class Clock {
        var nanos = 0L
            private set

        fun advance(ms: Double) {
            nanos += (ms * 1_000_000.0).toLong()
        }

        fun nowMs(): Double = nanos / 1_000_000.0
    }

    private class ErrorMeter {
        private val abs = ArrayList<Double>()
        var maxJumpMs = 0.0
        var backwardSteps = 0
        private var last = Double.NaN

        fun sample(error: Double, position: Double) {
            abs.add(abs(error))
            if (!last.isNaN()) {
                val jump = position - last
                if (jump > maxJumpMs) maxJumpMs = jump
                if (jump < -0.001) backwardSteps++
            }
            last = position
        }

        fun mean(): Double = if (abs.isEmpty()) 0.0 else abs.average()
        fun p95(): Double {
            if (abs.isEmpty()) return 0.0
            val s = abs.sorted()
            return s[Math.min(s.size - 1, (s.size * 95) / 100)]
        }

        fun max(): Double = if (abs.isEmpty()) 0.0 else abs.max()
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println("=== PlaybackTimeline deterministic tests ===")
        testSteadyState()
        testPauseResume()
        testSeekForward()
        testSeekBackward()
        testRateLearning()
        testBuffering()
        testTrackChange()
        testNoisyFeed()
        testIdleAndReset()
        println()
        if (failures > 0) {
            println("RESULT: FAIL ($failures/$checks checks failed)")
            System.exit(1)
        }
        println("RESULT: PASS ($checks checks)")
    }

    // ---------------------------------------------------------------- scenarios

    /** 1 Hz updates + 60 Hz sampling for 60 s; error vs true position. */
    private fun testSteadyState() {
        println("\n[steady state] 60 s, 1 Hz updates +-3 ms jitter, sampled at 60 Hz")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(240_000L, 0L)
        timeline.onIsPlayingChanged(true)
        timeline.onStateChanged(PlaybackState.READY)

        val meter = ErrorMeter()
        var nextUpdateMs = 0.0
        var nextSampleMs = 0.0
        var jitterMs = 3.0
        val endMs = 60_000.0
        while (clock.nowMs() < endMs) {
            // host: 1 Hz position report (reported position lags by up to one frame of jitter)
            if (clock.nowMs() >= nextUpdateMs) {
                val truePos = mathRound(clock.nowMs() - jitterMs)
                timeline.onPositionUpdated(truePos)
                nextUpdateMs += 1000.0
                jitterMs = -jitterMs
            }
            if (clock.nowMs() >= nextSampleMs) {
                val truePos = clock.nowMs()
                val pos = timeline.currentTimeMs()
                meter.sample(pos - truePos, pos)
                nextSampleMs += 1000.0 / 60.0
            }
            clock.advance(1.0) // 1 ms virtual step
        }
        println("  mean=%.2f ms p95=%.2f ms max=%.2f ms maxJump=%.2f ms backward=%d"
            .format(meter.mean(), meter.p95(), meter.max(), meter.maxJumpMs, meter.backwardSteps))
        check("mean error < 5 ms", meter.mean() < 5.0, "%.2f".format(meter.mean()))
        check("p95 error < 12 ms", meter.p95() < 12.0, "%.2f".format(meter.p95()))
        check("max error < 30 ms", meter.max() < 30.0, "%.2f".format(meter.max()))
        check("no backward jumps", meter.backwardSteps == 0, "${meter.backwardSteps}")
        val stats = timeline.stats()
        check("stats updated", stats.updates == 60L, "${stats.updates}")
        check("rate near 1.0", abs(stats.rate - 1.0) < 0.01, "%.4f".format(stats.rate))
        check("no hard snaps", stats.hardSnaps == 0L, "${stats.hardSnaps}")
    }

    private fun testPauseResume() {
        println("\n[pause/resume] frozen while paused, resumes from frozen position")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(240_000L, 0L)
        timeline.onIsPlayingChanged(true)
        timeline.onStateChanged(PlaybackState.READY)
        timeline.onPositionUpdated(0L)

        // Play 5 s.
        for (i in 1..5) {
            clock.advance(1000.0)
            timeline.onPositionUpdated(clock.nowMs().toLong())
        }
        val beforePause = timeline.currentTimeMs()
        near("playing position ~ wall clock", beforePause, clock.nowMs(), 20.0)

        timeline.onIsPlayingChanged(false)
        val atPause = timeline.currentTimeMs()
        clock.advance(3000.0)
        // Host still emits position updates while paused (same position).
        timeline.onPositionUpdated(atPause.toLong())
        clock.advance(1000.0)
        near("frozen while paused", timeline.currentTimeMs(), atPause, 0.01)

        timeline.onIsPlayingChanged(true)
        clock.advance(2000.0)
        near("resumes from frozen point", timeline.currentTimeMs(), atPause + 2000.0, 25.0)
        timeline.onPositionUpdated((atPause + 2000.0).toLong())
        near("re-anchored by next update", timeline.currentTimeMs(), atPause + 2000.0, 25.0)
    }

    private fun testSeekForward() {
        println("\n[seek forward] optimistic anchor, stale update ignored, ack accepted")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(240_000L, 0L)
        timeline.onIsPlayingChanged(true)
        timeline.onStateChanged(PlaybackState.READY)
        timeline.onPositionUpdated(0L)
        for (i in 1..10) {
            clock.advance(1000.0)
            timeline.onPositionUpdated(clock.nowMs().toLong())
        }
        near("pre-seek position", timeline.currentTimeMs(), 10_000.0, 20.0)

        timeline.onSeekTo(120_000L)
        near("jumps to seek target", timeline.currentTimeMs(), 120_000.0, 0.01)
        check("seek pending", timeline.snapshot().seekPending)

        clock.advance(100.0)
        timeline.onPositionUpdated(10_000L) // stale pre-seek update
        check("stale update ignored", timeline.currentTimeMs() >= 120_000.0,
            "%.2f".format(timeline.currentTimeMs()))

        clock.advance(900.0)
        timeline.onPositionUpdated(121_000L) // within tolerance -> ack
        check("seek acked", !timeline.snapshot().seekPending)
        near("post-ack position", timeline.currentTimeMs(), 121_000.0, 20.0)
        check("no timeout", timeline.stats().seeksTimedOut == 0L, "${timeline.stats().seeksTimedOut}")
    }

    private fun testSeekBackward() {
        println("\n[seek backward] also works downward")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(240_000L, 60_000L)
        timeline.onIsPlayingChanged(true)
        timeline.onStateChanged(PlaybackState.READY)
        timeline.onPositionUpdated(60_000L)
        clock.advance(1000.0)
        timeline.onPositionUpdated(61_000L)

        timeline.onSeekTo(5_000L)
        near("rewinds to target", timeline.currentTimeMs(), 5_000.0, 0.01)
        timeline.onPositionUpdated(5_100L)
        check("acked", !timeline.snapshot().seekPending)
        near("position after ack", timeline.currentTimeMs(), 5_100.0, 20.0)
    }

    private fun testRateLearning() {
        println("\n[rate] 1.5x playback is learned from 1 Hz updates")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(240_000L, 0L)
        timeline.onIsPlayingChanged(true)
        timeline.onStateChanged(PlaybackState.READY)
        timeline.onPositionUpdated(0L)
        var pos = 0L
        for (i in 1..8) {
            clock.advance(1000.0)
            pos += 1500
            timeline.onPositionUpdated(pos)
        }
        val rate = timeline.stats().rate
        check("learned rate ~1.5", abs(rate - 1.5) < 0.05, "%.4f".format(rate))
        // After the last update, 1 s of wall time must advance clearly more than realtime at 1x,
        // and the residual soft corrections must keep it close to the truth (1.5x -> 1500 ms).
        clock.advance(1000.0)
        val advanced = timeline.currentTimeMs() - pos
        check("interpolates faster than 1x", advanced > 1000.0, "%.1f ms".format(advanced))
        check("interpolates near 1.5x", abs(advanced - 1500.0) < 350.0, "%.1f ms".format(advanced))

        val beforeExplicit = timeline.currentTimeMs()
        timeline.onPlaybackRateChanged(2.0)
        clock.advance(500.0)
        near("explicit rate applied immediately", timeline.currentTimeMs() - beforeExplicit, 1000.0, 1.0)
    }

    private fun testBuffering() {
        println("\n[buffering] freezes the clock")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(240_000L, 0L)
        timeline.onIsPlayingChanged(true)
        timeline.onStateChanged(PlaybackState.READY)
        timeline.onPositionUpdated(0L)
        clock.advance(3000.0)
        timeline.onPositionUpdated(3000L)
        val atBuffer = timeline.currentTimeMs()
        timeline.onStateChanged(PlaybackState.BUFFERING)
        clock.advance(2000.0)
        near("frozen while buffering", timeline.currentTimeMs(), atBuffer, 0.01)
        timeline.onStateChanged(PlaybackState.READY)
        clock.advance(1000.0)
        near("resumes after buffering", timeline.currentTimeMs(), atBuffer + 1000.0, 30.0)
    }

    private fun testTrackChange() {
        println("\n[track change] new track resets to start")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(200_000L, 0L)
        timeline.onIsPlayingChanged(true)
        timeline.onPositionUpdated(0L)
        clock.advance(5000.0)
        timeline.onPositionUpdated(5000L)
        timeline.onTrackChanged(180_000L, 0L)
        near("reset to 0", timeline.currentTimeMs(), 0.0, 0.01)
        check("duration updated", timeline.snapshot().durationMs == 180_000L,
            "${timeline.snapshot().durationMs}")

        timeline.onPositionUpdated(0L)
        clock.advance(2000.0)
        timeline.onPositionUpdated(2000L)
        near("plays on new track", timeline.currentTimeMs(), 2000.0, 25.0)
    }

    private fun testNoisyFeed() {
        println("\n[noisy feed] +-40 ms jitter update noise stays below 200 ms jumps")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(240_000L, 0L)
        timeline.onIsPlayingChanged(true)
        timeline.onStateChanged(PlaybackState.READY)
        timeline.onPositionUpdated(0L)
        val meter = ErrorMeter()
        var nextUpdate = 0.0
        var nextSample = 0.0
        val jitter = doubleArrayOf(-40.0, 40.0, -25.0, 35.0, 0.0)
        var j = 0
        while (clock.nowMs() < 30_000.0) {
            if (clock.nowMs() >= nextUpdate) {
                timeline.onPositionUpdated((clock.nowMs() + jitter[j % jitter.size]).toLong())
                j++
                nextUpdate += 1000.0
            }
            if (clock.nowMs() >= nextSample) {
                meter.sample(timeline.currentTimeMs() - clock.nowMs(), timeline.currentTimeMs())
                nextSample += 1000.0 / 60.0
            }
            clock.advance(1.0)
        }
        println("  mean=%.2f ms p95=%.2f ms max=%.2f ms maxJump=%.2f ms"
            .format(meter.mean(), meter.p95(), meter.max(), meter.maxJumpMs))
        check("max single-frame jump < 200 ms", meter.maxJumpMs < 200.0,
            "%.2f".format(meter.maxJumpMs))
        // The host feed itself carries +-40 ms jitter, so the interpolated clock cannot be more
        // accurate than the measurements it is fed; it must smooth, not amplify, that noise.
        check("mean error < 45 ms", meter.mean() < 45.0, "%.2f".format(meter.mean()))
        check("p95 error < 90 ms", meter.p95() < 90.0, "%.2f".format(meter.p95()))
    }

    private fun testIdleAndReset() {
        println("\n[idle/reset] IDLE clears, reset clears")
        val clock = Clock()
        val timeline = PlaybackTimeline(clockNanos = { clock.nanos })
        timeline.onTrackChanged(240_000L, 30_000L)
        timeline.onIsPlayingChanged(true)
        timeline.onStateChanged(PlaybackState.ENDED)
        check("ended clamps to duration", abs(timeline.currentTimeMs() - 240_000.0) < 1.0,
            "%.2f".format(timeline.currentTimeMs()))
        check("ended flag", timeline.snapshot().ended)
        timeline.onStateChanged(PlaybackState.IDLE)
        near("IDLE resets position", timeline.currentTimeMs(), 0.0, 0.01)
        check("IDLE clears duration", timeline.snapshot().durationMs == 0L,
            "${timeline.snapshot().durationMs}")
        timeline.onPositionUpdated(12_345L)
        near("update after idle accepted", timeline.currentTimeMs(), 12_345.0, 0.01)
        timeline.reset()
        near("reset to zero", timeline.currentTimeMs(), 0.0, 0.01)
        check("rate reset", abs(timeline.stats().rate - 1.0) < 1e-9, "%.4f".format(timeline.stats().rate))
    }

    private fun mathRound(v: Double): Long = Math.round(v)
}
