package spwfolia.audio

/**
 * One audio analysis frame in the shape Folia style visualizers expect.
 *
 * Folia's page-side bridge (`usePlaybackVisualizerBridge.ts`) reads an AnalyserNode with
 * `getByteFrequencyData` (0..255), averages the bins of each named band, then applies
 * `shape(v, boost) = pow(v / 255, boost) * 255`. Everything here is already in that unit:
 *
 *  - [spectrum] : raw 1024-byte AnalyserNode spectrum (0..255, NOT gamma shaped). Folia
 *                 normalizes by itself in most styles; length 0 or 7..1024 is accepted there.
 *  - [bass]/[lowMid]/[mid]/[vocal]/[treble] : raw band byte means (0..255, pre-gamma).
 *  - [power]/[shapedBass]... : post-gamma values (0..255 floats) ready for `audioPower`.
 *
 * Frames are produced by the native helper (`spw-folia-host.exe`, C# `LoopbackAnalyzer`)
 * and reach the plugin either in-process (helper) or through the optional shared-memory
 * ring ([SpectrumReader]). `null`/empty [spectrum] together with [silent] means "no audio
 * signal right now" - consumers should render the Folia breath fallback, not zeros.
 */
interface FoliaAudioState {
    /** Monotonic producer-side sequence number (gaps mean dropped frames). */
    val sequence: Long

    /** Wall-clock timestamp (epoch ms) of the frame. */
    val timestampMs: Long

    /** Producer monotonic timestamp in ms (same clock as native `TsMonoMs`). */
    val monotonicMs: Double

    /** Folia `audioPower`: shape(mean(bass, lowMid), 3), 0..255. */
    val power: Float

    /** Shaped named bands, 0..255 (gamma applied, Folia boosts 1.8/2/2/1.5/2). */
    val shapedBass: Float
    val shapedLowMid: Float
    val shapedMid: Float
    val shapedVocal: Float
    val shapedTreble: Float

    /** Raw named band byte means, 0..255, before gamma (getByteFrequencyData parity). */
    val rawBass: Float
    val rawLowMid: Float
    val rawMid: Float
    val rawVocal: Float
    val rawTreble: Float

    /** Raw 1024-byte spectrum (0..255) or null when silent/paused. */
    val spectrum: ByteArray?

    /** Beat onset in this frame (Folia `beatImpact` source). */
    val beat: Boolean

    /** Beat was classified as a downbeat by the native 4-beat heuristic. */
    val beatDownbeat: Boolean

    /** Native onset strength 0..1. */
    val beatStrength: Float

    /** Overall RMS of the analysis window, full-scale 0..1 (post AGC when AGC enabled). */
    val rms: Float

    /** True when the analyzer detected silence (Folia should use breath values). */
    val silent: Boolean

    /** Capture-to-emit service lag in ms (excludes audio engine pre-render). */
    val latencyMs: Double

    fun shapedBands(): FloatArray =
        floatArrayOf(shapedBass, shapedLowMid, shapedMid, shapedVocal, shapedTreble)
}

/** Immutable concrete frame, convenient for tests, ring-buffer reads and message passing. */
class AudioFrameState(
    override val sequence: Long = 0L,
    override val timestampMs: Long = 0L,
    override val monotonicMs: Double = 0.0,
    override val power: Float = 0f,
    override val shapedBass: Float = 0f,
    override val shapedLowMid: Float = 0f,
    override val shapedMid: Float = 0f,
    override val shapedVocal: Float = 0f,
    override val shapedTreble: Float = 0f,
    override val rawBass: Float = 0f,
    override val rawLowMid: Float = 0f,
    override val rawMid: Float = 0f,
    override val rawVocal: Float = 0f,
    override val rawTreble: Float = 0f,
    override val spectrum: ByteArray? = null,
    override val beat: Boolean = false,
    override val beatDownbeat: Boolean = false,
    override val beatStrength: Float = 0f,
    override val rms: Float = 0f,
    override val silent: Boolean = false,
    override val latencyMs: Double = 0.0,
) : FoliaAudioState {
    override fun toString(): String =
        "AudioFrameState(seq=$sequence, ts=$timestampMs, power=${"%.1f".format(power)}, " +
            "bands=${"%.1f".format(shapedBass)}/${"%.1f".format(shapedLowMid)}/" +
            "${"%.1f".format(shapedMid)}/${"%.1f".format(shapedVocal)}/${"%.1f".format(shapedTreble)}, " +
            "beat=$beat, silent=$silent, spec=${spectrum?.size ?: 0})"
}

/**
 * Pure math shared with the native analyzer, so plugin-side fallback frames (paused / no
 * device) stay byte-identical to what the helper produces. Formulas mirror Folia
 * `usePlaybackVisualizerBridge.ts` and `SpectrumAnalyzer.cs` / `FoliaAudioMapper.cs`.
 */
object FoliaAudioMapper {
    /** Folia `process(v, boost) = pow(v / 255, boost) * 255`, clamped to 0..255. */
    fun shape(v: Double, boost: Double): Float {
        val out = Math.pow(v / 255.0, boost) * 255.0
        return out.coerceIn(0.0, 255.0).toFloat()
    }

    /**
     * Pause/ended "breathing" value: `(sin(Date.now() / 2000) + 1) * 20`, range 0..40.
     * Folia styles use this instead of zeros so the visualizer keeps a subtle heartbeat.
     */
    fun breath(nowMs: Long): Float = ((Math.sin(nowMs / 2000.0) + 1.0) * 20.0).toFloat()

    /** All five bands of the paused payload (Folia writes breath into power + bands). */
    fun pausedBands(nowMs: Long): FloatArray {
        val b = breath(nowMs)
        return floatArrayOf(b, b, b, b, b)
    }

    fun pausedPower(nowMs: Long): Float = breath(nowMs)
}
