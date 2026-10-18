package spwfolia.audio

import java.io.Closeable
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Path
import java.nio.file.Paths

/**
 * On-disk layout of the optional audio ring buffer written by the native analyzer
 * (`poc/audio/native/SharedAudioRing.cs`, `SharedAudioRingLayout`).
 *
 * The native side memory-maps a plain file (Windows named shared memory cannot be mapped from
 * the JVM), so both processes map the same file and see the same page cache. All integers are
 * little endian. Version 2 carries the full 1024-byte AnalyserNode spectrum.
 *
 * ```
 * header (64 B):  u32 magic 'SPWF' | u32 version=2 | u32 slotSize=1536 | u32 capacity=256
 *                 u32 sampleRate | u32 fftSize=2048 | i64 writeSeq | i64 startEpochMs | i64 writerPid
 * slot  (1536 B): i64 seq | i64 tsEpochMs | f64 tsMonoMs | i64 samplePos | u32 sampleRate
 *                 u32 spectrumLength | f32 rawBass | rawLowMid | rawMid | rawVocal | rawTreble
 *                 f32 power | bass | lowMid | mid | vocal | treble | rms | agcGain
 *                 f32 beatStrength | f32 latencyMs | u32 flags (bit0 beat, bit1 silent, bit2 downbeat)
 *                 u8 spectrum[1024] at offset 128
 * ```
 *
 * Commit protocol: the writer fills the slot, writes the slot sequence number, then publishes the
 * new `writeSeq` in the header. Readers only consume slots with `seq <= header.writeSeq` and skip
 * slots whose sequence no longer matches (writer lapped them).
 */
object SharedAudioRingFormat {
    const val MAGIC: Int = 0x46575053 // 'SPWF' as little-endian bytes 'S','P','W','F'
    const val VERSION: Int = 2
    const val HEADER_SIZE: Int = 64
    const val SLOT_SIZE: Int = 1536
    const val CAPACITY: Int = 256
    const val TOTAL_SIZE: Int = HEADER_SIZE + SLOT_SIZE * CAPACITY // 393280
    const val SPECTRUM_CAPACITY: Int = 1024

    const val HEADER_SAMPLE_RATE = 16
    const val HEADER_FFT_SIZE = 20
    const val HEADER_WRITE_SEQ = 24
    const val HEADER_START_EPOCH_MS = 32
    const val HEADER_WRITER_PID = 40

    const val OFFSET_SEQ = 0
    const val OFFSET_TS_EPOCH_MS = 8
    const val OFFSET_TS_MONO_MS = 16
    const val OFFSET_SAMPLE_POS = 24
    const val OFFSET_SAMPLE_RATE = 32
    const val OFFSET_SPECTRUM_LENGTH = 36
    const val OFFSET_RAW_BASS = 40
    const val OFFSET_RAW_LOW_MID = 44
    const val OFFSET_RAW_MID = 48
    const val OFFSET_RAW_VOCAL = 52
    const val OFFSET_RAW_TREBLE = 56
    const val OFFSET_POWER = 60
    const val OFFSET_BASS = 64
    const val OFFSET_LOW_MID = 68
    const val OFFSET_MID = 72
    const val OFFSET_VOCAL = 76
    const val OFFSET_TREBLE = 80
    const val OFFSET_RMS = 84
    const val OFFSET_AGC_GAIN = 88
    const val OFFSET_BEAT_STRENGTH = 92
    const val OFFSET_LATENCY_MS = 96
    const val OFFSET_FLAGS = 100
    const val OFFSET_SPECTRUM = 128

    const val FLAG_BEAT = 1
    const val FLAG_SILENT = 2
    const val FLAG_DOWNBEAT = 4

    /** The native helper's default path: `%TEMP%\\spw-folia-audio.shm`. */
    fun defaultPath(): Path = Paths.get(System.getProperty("java.io.tmpdir"), "spw-folia-audio.shm")
}

class SharedAudioRingHeader(
    val sampleRate: Int,
    val fftSize: Int,
    val startEpochMs: Long,
    val writerPid: Long,
    val writeSeq: Long,
)

class SharedAudioRingException(message: String) : RuntimeException(message)

/**
 * Reads frames from the native audio ring file. Thread-safe; polling is cheap (one header read +
 * one slot read per new frame). The reader tolerates the writer lapping slots (skips them) and
 * never throws on a normal "no new frames" poll.
 *
 * Usage:
 * ```
 * SpectrumReader(path).use { reader ->
 *     while (true) {
 *         reader.readNewFrames().forEach { frame -> avatarAudio.onFrame(frame) }
 *         Thread.sleep(8)
 *     }
 * }
 * ```
 */
class SpectrumReader(
    private val path: Path,
    /** On the first poll, skip the backlog and only return frames written after construction. */
    private val startFromLatest: Boolean = true,
) : Closeable {
    private val lock = Any()
    private var raf: RandomAccessFile? = null
    private var lastSeq: Long = 0
    private var closed = false

    @Volatile
    var header: SharedAudioRingHeader? = null
        private set

    init {
        openAndValidate()
    }

    private fun openAndValidate() {
        val file = RandomAccessFile(path.toFile(), "rw")
        raf = file
        if (file.length() < SharedAudioRingFormat.HEADER_SIZE) {
            closeQuietly()
            throw SharedAudioRingException("ring file too short: ${file.length()} B (path=$path)")
        }
        val buf = ByteBuffer.allocate(SharedAudioRingFormat.HEADER_SIZE).order(ByteOrder.LITTLE_ENDIAN)
        file.seek(0)
        file.readFully(buf.array())
        val magic = buf.getInt(0)
        val version = buf.getInt(4)
        val slotSize = buf.getInt(8)
        val capacity = buf.getInt(12)
        if (magic != SharedAudioRingFormat.MAGIC) {
            closeQuietly()
            throw SharedAudioRingException(
                "bad ring magic 0x${Integer.toHexString(magic)} (expected SPWF / 0x46575053) at $path"
            )
        }
        if (version != SharedAudioRingFormat.VERSION) {
            closeQuietly()
            throw SharedAudioRingException("unsupported ring version $version (expected ${SharedAudioRingFormat.VERSION})")
        }
        if (slotSize != SharedAudioRingFormat.SLOT_SIZE || capacity != SharedAudioRingFormat.CAPACITY) {
            closeQuietly()
            throw SharedAudioRingException("unexpected ring geometry slot=$slotSize cap=$capacity")
        }
        val h = SharedAudioRingHeader(
            sampleRate = buf.getInt(SharedAudioRingFormat.HEADER_SAMPLE_RATE),
            fftSize = buf.getInt(SharedAudioRingFormat.HEADER_FFT_SIZE),
            startEpochMs = buf.getLong(SharedAudioRingFormat.HEADER_START_EPOCH_MS),
            writerPid = buf.getLong(SharedAudioRingFormat.HEADER_WRITER_PID),
            writeSeq = buf.getLong(SharedAudioRingFormat.HEADER_WRITE_SEQ),
        )
        header = h
        lastSeq = if (startFromLatest) h.writeSeq else 0L
    }

    /** Reads every frame written since the last call, oldest first. */
    fun readNewFrames(): List<AudioFrameState> = synchronized(lock) {
        if (closed) return emptyList()
        val file = raf ?: return emptyList()
        val headerBytes = ByteBuffer.allocate(SharedAudioRingFormat.HEADER_SIZE).order(ByteOrder.LITTLE_ENDIAN)
        file.seek(0)
        file.readFully(headerBytes.array())
        val writeSeq = headerBytes.getLong(SharedAudioRingFormat.HEADER_WRITE_SEQ)
        if (writeSeq <= lastSeq) return emptyList()

        // Bound a single poll so a long stall cannot hand the caller thousands of stale frames.
        val maxFrames = SharedAudioRingFormat.CAPACITY
        val from = maxOf(lastSeq + 1, writeSeq - maxFrames + 1)
        val slotBytes = ByteArray(SharedAudioRingFormat.SLOT_SIZE)
        val slot = ByteBuffer.wrap(slotBytes).order(ByteOrder.LITTLE_ENDIAN)
        val out = ArrayList<AudioFrameState>((writeSeq - lastSeq).toInt().coerceAtMost(8))
        var seq = from
        while (seq <= writeSeq) {
            val slotIndex = ((seq - 1) % SharedAudioRingFormat.CAPACITY).toInt()
            file.seek((SharedAudioRingFormat.HEADER_SIZE + slotIndex * SharedAudioRingFormat.SLOT_SIZE).toLong())
            file.readFully(slotBytes)
            val slotSeq = slot.getLong(SharedAudioRingFormat.OFFSET_SEQ)
            if (slotSeq == seq) out.add(parseSlot(slot, seq))
            // else: writer lapped this slot while we were reading - drop it silently.
            seq++
        }
        lastSeq = writeSeq
        out
    }

    /** Convenience: newest frame seen so far (or null when the writer has not produced one yet). */
    fun readLatest(): AudioFrameState? {
        readNewFrames()
        return lastFrame
    }

    private var lastFrame: AudioFrameState? = null

    private fun parseSlot(slot: ByteBuffer, seq: Long): AudioFrameState {
        val specLen = slot.getInt(SharedAudioRingFormat.OFFSET_SPECTRUM_LENGTH)
            .coerceIn(0, SharedAudioRingFormat.SPECTRUM_CAPACITY)
        val flags = slot.getInt(SharedAudioRingFormat.OFFSET_FLAGS)
        val silent = (flags and SharedAudioRingFormat.FLAG_SILENT) != 0
        val spectrum: ByteArray? =
            if (specLen == 0) null
            else ByteArray(specLen).also { src ->
                val base = SharedAudioRingFormat.OFFSET_SPECTRUM
                for (i in 0 until specLen) src[i] = slot.get(base + i)
            }
        val frame = AudioFrameState(
            sequence = seq,
            timestampMs = slot.getLong(SharedAudioRingFormat.OFFSET_TS_EPOCH_MS),
            monotonicMs = slot.getDouble(SharedAudioRingFormat.OFFSET_TS_MONO_MS),
            power = slot.getFloat(SharedAudioRingFormat.OFFSET_POWER),
            shapedBass = slot.getFloat(SharedAudioRingFormat.OFFSET_BASS),
            shapedLowMid = slot.getFloat(SharedAudioRingFormat.OFFSET_LOW_MID),
            shapedMid = slot.getFloat(SharedAudioRingFormat.OFFSET_MID),
            shapedVocal = slot.getFloat(SharedAudioRingFormat.OFFSET_VOCAL),
            shapedTreble = slot.getFloat(SharedAudioRingFormat.OFFSET_TREBLE),
            rawBass = slot.getFloat(SharedAudioRingFormat.OFFSET_RAW_BASS),
            rawLowMid = slot.getFloat(SharedAudioRingFormat.OFFSET_RAW_LOW_MID),
            rawMid = slot.getFloat(SharedAudioRingFormat.OFFSET_RAW_MID),
            rawVocal = slot.getFloat(SharedAudioRingFormat.OFFSET_RAW_VOCAL),
            rawTreble = slot.getFloat(SharedAudioRingFormat.OFFSET_RAW_TREBLE),
            spectrum = spectrum,
            beat = (flags and SharedAudioRingFormat.FLAG_BEAT) != 0,
            beatDownbeat = (flags and SharedAudioRingFormat.FLAG_DOWNBEAT) != 0,
            beatStrength = slot.getFloat(SharedAudioRingFormat.OFFSET_BEAT_STRENGTH),
            rms = slot.getFloat(SharedAudioRingFormat.OFFSET_RMS),
            silent = silent,
            latencyMs = slot.getFloat(SharedAudioRingFormat.OFFSET_LATENCY_MS).toDouble(),
        )
        lastFrame = frame
        return frame
    }

    override fun close() {
        synchronized(lock) {
            closed = true
            closeQuietly()
        }
    }

    private fun closeQuietly() {
        try {
            raf?.close()
        } catch (_: Exception) {
        } finally {
            raf = null
        }
    }
}
