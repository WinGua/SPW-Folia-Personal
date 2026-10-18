package fake.host

/**
 * Fake host object graph structurally matched to SPW 1.19.0 (names simplified so the test does not
 * reproduce obfuscated identifiers):
 *
 *  - `FakeController` is a Kotlin `object` -> public static `INSTANCE` field (like PlaybackController).
 *  - It holds a **private** `service` field of type `FakeService` (like `PlaybackController.service`).
 *  - `FakeService` exposes `getPlayer(): FakePlayer` (like the inherited `getPlayer()` in the
 *    relocated PlaybackService base class).
 *  - `FakePlayer` has two no-arg `long` getters: `pos()` (advances in real time) and `dur()`
 *    (constant), plus unrelated getters of other return types that the probe must ignore.
 */
object FakeController {
    @Suppress("unused")
    private val service = FakeService()
}

class FakeService {
    @Suppress("unused")
    private val player = FakePlayer()

    @Suppress("unused")
    fun getPlayer(): FakePlayer = player
}

class FakePlayer {
    companion object {
        const val DURATION_MS = 245_000L
    }

    private val startNanos = System.nanoTime()
    private val basePosMs = 12_000L

    /** Increments in real time, like the host player position while playing. */
    fun pos(): Long = basePosMs + (System.nanoTime() - startNanos) / 1_000_000L

    /** Fixed track duration. */
    fun dur(): Long = DURATION_MS

    // Noise getters that must NOT be mistaken for position/duration.
    fun deviceIndex(): Int = 3
    fun fft(): FloatArray = FloatArray(256)
}

/** Fake `PlaybackMonitor` with a StateFlow-like `lyricsTime` holder. */
object FakeMonitor {
    @Suppress("unused")
    private val lyricsTime = FakeStateFlow(12_345L)

    @Suppress("unused")
    fun getLyricsTime(): FakeStateFlow = lyricsTime
}

class FakeStateFlow(initial: Long) {
    @Volatile
    var value: Long = initial
}
