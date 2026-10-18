package spwfolia.audio

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.nio.file.Path
import java.util.Random

/**
 * Deterministic tests for the shared-memory ring reader ([SpectrumReader]) plus an optional
 * end-to-end read of a ring file produced by the native helper
 * (`spw-folia-spectrum.exe --seconds N --shm <path>`).
 *
 * Run via `poc/audio/run-tests.sh [path-to-native-shm]`.
 */
object SpectrumReaderTest {
    private var failures = 0
    private var checks = 0

    private fun check(name: String, condition: Boolean, detail: String) {
        checks++
        if (condition) println("  PASS  $name ($detail)") else {
            failures++
            println("  FAIL  $name ($detail)")
        }
    }

    // ------------------------------------------------------------- ring writer (test only)

    private fun fakeFrame(
        seq: Long,
        silent: Boolean = false,
        beat: Boolean = !silent && seq % 10 == 0L,
        downbeat: Boolean = !silent && seq % 40 == 0L,
    ): AudioFrameState {
        val rnd = Random(seq * 31 + 7)
        return AudioFrameState(
            sequence = seq,
            timestampMs = 1_700_000_000_000L + seq * 16,
            monotonicMs = seq * 16.666,
            power = 120.5f + seq,
            shapedBass = 30f, shapedLowMid = 40f, shapedMid = 50f, shapedVocal = 20f, shapedTreble = 10f,
            rawBass = 60f, rawLowMid = 70f, rawMid = 80f, rawVocal = 40f, rawTreble = 20f,
            spectrum = if (silent) null else ByteArray(1024) { rnd.nextInt(256).toByte() },
            beat = beat,
            beatDownbeat = downbeat,
            beatStrength = if (silent) 0f else 0.75f,
            rms = if (silent) 0f else 0.33f,
            silent = silent,
            latencyMs = 2.5,
        )
    }

    private fun writeFrame(slot: ByteBuffer, f: AudioFrameState) {
        slot.putLong(SharedAudioRingFormat.OFFSET_SEQ, f.sequence)
        slot.putLong(SharedAudioRingFormat.OFFSET_TS_EPOCH_MS, f.timestampMs)
        slot.putDouble(SharedAudioRingFormat.OFFSET_TS_MONO_MS, f.monotonicMs)
        slot.putLong(SharedAudioRingFormat.OFFSET_SAMPLE_POS, f.sequence * 960)
        slot.putInt(SharedAudioRingFormat.OFFSET_SAMPLE_RATE, 48_000)
        val spec = f.spectrum ?: ByteArray(0)
        slot.putInt(SharedAudioRingFormat.OFFSET_SPECTRUM_LENGTH, spec.size)
        slot.putFloat(SharedAudioRingFormat.OFFSET_RAW_BASS, f.rawBass)
        slot.putFloat(SharedAudioRingFormat.OFFSET_RAW_LOW_MID, f.rawLowMid)
        slot.putFloat(SharedAudioRingFormat.OFFSET_RAW_MID, f.rawMid)
        slot.putFloat(SharedAudioRingFormat.OFFSET_RAW_VOCAL, f.rawVocal)
        slot.putFloat(SharedAudioRingFormat.OFFSET_RAW_TREBLE, f.rawTreble)
        slot.putFloat(SharedAudioRingFormat.OFFSET_POWER, f.power)
        slot.putFloat(SharedAudioRingFormat.OFFSET_BASS, f.shapedBass)
        slot.putFloat(SharedAudioRingFormat.OFFSET_LOW_MID, f.shapedLowMid)
        slot.putFloat(SharedAudioRingFormat.OFFSET_MID, f.shapedMid)
        slot.putFloat(SharedAudioRingFormat.OFFSET_VOCAL, f.shapedVocal)
        slot.putFloat(SharedAudioRingFormat.OFFSET_TREBLE, f.shapedTreble)
        slot.putFloat(SharedAudioRingFormat.OFFSET_RMS, f.rms)
        slot.putFloat(SharedAudioRingFormat.OFFSET_AGC_GAIN, 1f)
        slot.putFloat(SharedAudioRingFormat.OFFSET_BEAT_STRENGTH, f.beatStrength)
        slot.putFloat(SharedAudioRingFormat.OFFSET_LATENCY_MS, f.latencyMs.toFloat())
        var flags = 0
        if (f.beat) flags = flags or SharedAudioRingFormat.FLAG_BEAT
        if (f.silent) flags = flags or SharedAudioRingFormat.FLAG_SILENT
        if (f.beatDownbeat) flags = flags or SharedAudioRingFormat.FLAG_DOWNBEAT
        slot.putInt(SharedAudioRingFormat.OFFSET_FLAGS, flags)
        for (i in spec.indices) slot.put(SharedAudioRingFormat.OFFSET_SPECTRUM + i, spec[i])
    }

    private fun slotOffset(seq: Long): Long =
        (SharedAudioRingFormat.HEADER_SIZE +
            (((seq - 1) % SharedAudioRingFormat.CAPACITY) * SharedAudioRingFormat.SLOT_SIZE).toInt()).toLong()

    private fun createRing(path: Path, frames: List<AudioFrameState>) {
        val buf = ByteBuffer.allocate(SharedAudioRingFormat.TOTAL_SIZE).order(ByteOrder.LITTLE_ENDIAN)
        buf.putInt(0, SharedAudioRingFormat.MAGIC)
        buf.putInt(4, SharedAudioRingFormat.VERSION)
        buf.putInt(8, SharedAudioRingFormat.SLOT_SIZE)
        buf.putInt(12, SharedAudioRingFormat.CAPACITY)
        buf.putInt(SharedAudioRingFormat.HEADER_SAMPLE_RATE, 48_000)
        buf.putInt(SharedAudioRingFormat.HEADER_FFT_SIZE, 2048)
        buf.putLong(SharedAudioRingFormat.HEADER_START_EPOCH_MS, 1_700_000_000_000L)
        buf.putLong(SharedAudioRingFormat.HEADER_WRITER_PID, 4242)
        buf.putLong(SharedAudioRingFormat.HEADER_WRITE_SEQ, if (frames.isEmpty()) 0L else frames.last().sequence)
        for (f in frames) {
            val slot = ByteBuffer.wrap(ByteArray(SharedAudioRingFormat.SLOT_SIZE)).order(ByteOrder.LITTLE_ENDIAN)
            writeFrame(slot, f)
            buf.position(slotOffset(f.sequence).toInt())
            buf.put(slot.array())
        }
        Files.write(path, buf.array())
    }

    private fun appendFrame(path: Path, frame: AudioFrameState) {
        val bytes = Files.readAllBytes(path)
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val slot = ByteBuffer.wrap(ByteArray(SharedAudioRingFormat.SLOT_SIZE)).order(ByteOrder.LITTLE_ENDIAN)
        writeFrame(slot, frame)
        buf.position(slotOffset(frame.sequence).toInt())
        buf.put(slot.array())
        buf.putLong(SharedAudioRingFormat.HEADER_WRITE_SEQ, frame.sequence)
        Files.write(path, bytes)
    }

    // ------------------------------------------------------------------- tests

    private fun testRoundTrip(dir: Path) {
        println("[round trip] 3 synthetic frames incl. silent frame")
        val path = dir.resolve("reader-test-roundtrip.shm")
        Files.deleteIfExists(path)
        createRing(
            path,
            listOf(
                fakeFrame(1, beat = true),
                fakeFrame(2, beat = true, downbeat = true),
                fakeFrame(3, silent = true),
            ),
        )
        SpectrumReader(path, startFromLatest = false).use { reader ->
            val h = reader.header
            check("header sample rate", h?.sampleRate == 48_000, "${h?.sampleRate}")
            check("header fft size", h?.fftSize == 2048, "${h?.fftSize}")
            check("header start epoch", h?.startEpochMs == 1_700_000_000_000L, "${h?.startEpochMs}")
            val frames = reader.readNewFrames()
            check("frame count", frames.size == 3, "${frames.size}")
            val f1 = frames[0]
            check("sequence", f1.sequence == 1L, "${f1.sequence}")
            check("spectrum length 1024", f1.spectrum?.size == 1024, "${f1.spectrum?.size}")
            check("raw mid roundtrip", Math.abs(f1.rawMid - 80f) < 1e-6, "${f1.rawMid}")
            check("shaped power roundtrip", Math.abs(f1.power - 121.5f) < 1e-3, "${f1.power}")
            check("silent frame spectrum null", frames[2].spectrum == null, "${frames[2].spectrum?.size}")
            check("silent flag", frames[2].silent, "${frames[2].silent}")
            check("beat flag", f1.beat && !f1.beatDownbeat, "beat=${f1.beat}")
            check("downbeat flag", frames[1].beatDownbeat && !frames[1].silent, "downbeat=${frames[1].beatDownbeat}")
            check("no replay of consumed frames", reader.readNewFrames().isEmpty(), "empty")
        }
    }

    private fun testStartFromLatest(dir: Path) {
        println("[start from latest] backlog skipped, new frame picked up")
        val path = dir.resolve("reader-test-latest.shm")
        Files.deleteIfExists(path)
        createRing(path, listOf(fakeFrame(1), fakeFrame(2)))
        SpectrumReader(path, startFromLatest = true).use { reader ->
            check("backlog skipped", reader.readNewFrames().isEmpty(), "empty")
            appendFrame(path, fakeFrame(3))
            val frames = reader.readNewFrames()
            check("new frame read", frames.size == 1 && frames[0].sequence == 3L, "${frames.size}")
            check("readLatest returns last", reader.readLatest()?.sequence == 3L, "${reader.readLatest()?.sequence}")
        }
    }

    private fun testCorruptMagic(dir: Path) {
        println("[corrupt file] bad magic rejected")
        val path = dir.resolve("reader-test-corrupt.shm")
        Files.deleteIfExists(path)
        val bytes = ByteArray(SharedAudioRingFormat.TOTAL_SIZE)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).putInt(0, 0x12345678)
        Files.write(path, bytes)
        val threw = try {
            SpectrumReader(path).close()
            false
        } catch (_: SharedAudioRingException) {
            true
        }
        check("bad magic throws", threw, "SharedAudioRingException")
    }

    /** Optional end-to-end check against a ring written by the real native helper. */
    private fun testNativeFile(pathArg: String?) {
        if (pathArg.isNullOrBlank()) {
            println("[native file] skipped (no path argument; pass a .shm written by the native helper)")
            return
        }
        val path = Path.of(pathArg)
        if (!Files.exists(path)) {
            println("[native file] skipped (missing $path)")
            return
        }
        println("[native file] reading $path")
        SpectrumReader(path, startFromLatest = false).use { reader ->
            val frames = reader.readNewFrames()
            check("native frames present", frames.isNotEmpty(), "${frames.size} frames")
            if (frames.isNotEmpty()) {
                val f = frames.last()
                check("native seq > 0", f.sequence > 0, "${f.sequence}")
                val spec = f.spectrum
                check("native spectrum length", spec == null || spec.size in intArrayOf(1024),
                    "${spec?.size}")
                check("native shaped band range", f.shapedBass in 0f..256f && f.power in 0f..256f,
                    "power=${f.power} bass=${f.shapedBass}")
                check("native latency >= 0", f.latencyMs >= 0.0, "${f.latencyMs}")
                println("  sample: $f")
            }
        }
    }

    @JvmStatic
    fun main(args: Array<String>) {
        println("SpectrumReader tests (synthetic ring fixtures, optional native file)")
        val dir = Files.createTempDirectory("spw-folia-reader-test")
        try {
            testRoundTrip(dir)
            testStartFromLatest(dir)
            testCorruptMagic(dir)
            testNativeFile(args.firstOrNull())
        } finally {
            dir.toFile().deleteRecursively()
        }
        println()
        println("RESULT: $checks checks, $failures failures")
        if (failures > 0) System.exit(1)
    }
}
