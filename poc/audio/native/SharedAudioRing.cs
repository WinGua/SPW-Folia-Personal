// SPDX-License-Identifier: MIT
// File-backed shared-memory ring buffer for AudioFrame transport (diagnostics / non-WebView clients).
//
// Contract v1 note: audio analysis now runs INSIDE the native host process and is pushed to the
// WebView page over PostWebMessageAsJson, so this ring is NOT on the critical path. It is kept as
// an optional diagnostic channel (harness --shm) and as the transport should the JVM ever need
// audio again. Format below matches AudioFrame contract v2 (1024 raw spectrum bytes, 0..255 shaped
// bands, shaped+raw band levels).
//
// Transport choice: a *file-backed* memory-mapped file (not a Windows named mapping object), because
// the JVM cannot map a named Windows section directly -- it can map the same file with
// RandomAccessFile + FileChannel.map(), and Windows keeps both mappings coherent via the page cache.
//
// Layout (little-endian, 64-byte header, then capacity slots of 1536 bytes):
//   header:
//     0  u32 magic "SPWF" LE (0x46575053)
//     4  u32 version = 2
//     8  u32 slotSize = 1536
//    12  u32 capacity = 256
//    16  u32 sampleRate
//    20  u32 fftSize = 2048
//    24  i64 writeSeq          (seq of last fully written frame; 0 = nothing yet)
//    32  i64 writerStartEpochMs
//    40  i64 writerPid
//    48  reserved[16]
//   slot i (offset = 64 + i*1536), writer stores seq at index (seq-1) % capacity:
//     0   i64 seq               (written last as commit marker)
//     8   i64 tsEpochMs
//    16   f64 tsMonoMs
//    24   i64 samplePos
//    32   u32 sampleRate
//    36   u32 spectrumLength   (1024 normal, 0 = silent/no-signal frame)
//    40   f32 rawBass  44 rawLowMid  48 rawMid  52 rawVocal  56 rawTreble     (0..255)
//    60   f32 power    64 bass  68 lowMid  72 mid  76 vocal  80 treble         (shaped 0..255)
//    84   f32 rms      88 f32 agcGain  92 f32 beatStrength  96 f32 latencyMs
//   100   u32 flags (bit0 = beat, bit1 = silent, bit2 = downbeat)
//   104   reserved[24]
//   128   u8 spectrum[1024]
//  1152   reserved[384]
//
// Writer is single-producer: fill slot, publish slot seq[0], then publish header writeSeq.
// Readers poll header writeSeq; a reader that falls behind simply misses frames (ring semantics)
// and starts at the newest frame when it attaches.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.MemoryMappedFiles;

namespace SpwFolia.Audio
{
    public static class SharedAudioRingLayout
    {
        public const uint Magic = 0x46575053; // "SPWF"
        public const uint Version = 2;
        public const int HeaderSize = 64;
        public const int SlotSize = 1536;
        public const int Capacity = 256;
        public const int TotalSize = HeaderSize + SlotSize * Capacity; // 393280
        public const int SpectrumCapacity = 1024;

        // slot offsets
        public const int OffsetSeq = 0;
        public const int OffsetTsEpochMs = 8;
        public const int OffsetTsMonoMs = 16;
        public const int OffsetSamplePos = 24;
        public const int OffsetSampleRate = 32;
        public const int OffsetSpectrumLength = 36;
        public const int OffsetRawBass = 40;
        public const int OffsetRawLowMid = 44;
        public const int OffsetRawMid = 48;
        public const int OffsetRawVocal = 52;
        public const int OffsetRawTreble = 56;
        public const int OffsetPower = 60;
        public const int OffsetBass = 64;
        public const int OffsetLowMid = 68;
        public const int OffsetMid = 72;
        public const int OffsetVocal = 76;
        public const int OffsetTreble = 80;
        public const int OffsetRms = 84;
        public const int OffsetAgcGain = 88;
        public const int OffsetBeatStrength = 92;
        public const int OffsetLatencyMs = 96;
        public const int OffsetFlags = 100;
        public const int OffsetSpectrum = 128;

        // header offsets
        public const int HeaderOffsetSampleRate = 16;
        public const int HeaderOffsetFftSize = 20;
        public const int HeaderOffsetWriteSeq = 24;
        public const int HeaderOffsetStartEpochMs = 32;
        public const int HeaderOffsetWriterPid = 40;

        public static string DefaultPath
        {
            get { return Path.Combine(Path.GetTempPath(), "spw-folia-audio.shm"); }
        }
    }

    public sealed class SharedAudioRingWriter : IDisposable
    {
        private MemoryMappedFile _mmf;
        private MemoryMappedViewAccessor _view;
        private FileStream _file;
        private readonly byte[] _slot = new byte[SharedAudioRingLayout.SlotSize];
        private long _seq;
        private readonly int _sampleRate;

        public string Path { get; private set; }

        public SharedAudioRingWriter(string path, int sampleRate)
        {
            Path = path;
            _sampleRate = sampleRate;

            string dir = System.IO.Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);

            MemoryMappedFile mmf = null;
            MemoryMappedViewAccessor view = null;
            FileStream file = null;
            try
            {
                // Keep our own FileStream (FileShare.ReadWrite) and map through it: mapping must be
                // shareable so a reader in another process can map the same file concurrently.
                file = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.ReadWrite);
                if (file.Length != SharedAudioRingLayout.TotalSize) file.SetLength(SharedAudioRingLayout.TotalSize);
                mmf = MemoryMappedFile.CreateFromFile(file, null, SharedAudioRingLayout.TotalSize,
                    MemoryMappedFileAccess.ReadWrite, HandleInheritability.None, true);
                view = mmf.CreateViewAccessor(0, SharedAudioRingLayout.TotalSize, MemoryMappedFileAccess.ReadWrite);

                view.Write(0, SharedAudioRingLayout.Magic);
                view.Write(4, SharedAudioRingLayout.Version);
                view.Write(8, (uint)SharedAudioRingLayout.SlotSize);
                view.Write(12, (uint)SharedAudioRingLayout.Capacity);
                view.Write(SharedAudioRingLayout.HeaderOffsetSampleRate, (uint)sampleRate);
                view.Write(SharedAudioRingLayout.HeaderOffsetFftSize, 2048u);
                view.Write(SharedAudioRingLayout.HeaderOffsetWriteSeq, 0L);
                view.Write(SharedAudioRingLayout.HeaderOffsetStartEpochMs,
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                view.Write(SharedAudioRingLayout.HeaderOffsetWriterPid,
                    (long)Process.GetCurrentProcess().Id);
                view.Flush();
                _mmf = mmf;
                _view = view;
                _file = file;
            }
            catch
            {
                if (view != null) view.Dispose();
                if (mmf != null) mmf.Dispose();
                if (file != null) file.Dispose();
                throw;
            }
        }

        public long Seq { get { return _seq; } }

        public void WriteFrame(AudioFrame f)
        {
            if (_view == null) return;
            long seq = ++_seq;
            int slotIndex = (int)((seq - 1) % SharedAudioRingLayout.Capacity);
            int slotOffset = SharedAudioRingLayout.HeaderSize + slotIndex * SharedAudioRingLayout.SlotSize;
            byte[] s = _slot;
            Array.Clear(s, 0, s.Length);

            int specLen = f.Spectrum != null ? f.Spectrum.Length : 0;
            if (specLen > SharedAudioRingLayout.SpectrumCapacity) specLen = SharedAudioRingLayout.SpectrumCapacity;

            WriteI64(s, SharedAudioRingLayout.OffsetTsEpochMs, f.TsEpochMs);
            WriteF64(s, SharedAudioRingLayout.OffsetTsMonoMs, f.TsMonoMs);
            WriteI64(s, SharedAudioRingLayout.OffsetSamplePos, f.SamplePos);
            WriteU32(s, SharedAudioRingLayout.OffsetSampleRate, (uint)(f.SampleRate > 0 ? f.SampleRate : _sampleRate));
            WriteU32(s, SharedAudioRingLayout.OffsetSpectrumLength, (uint)specLen);
            WriteF32(s, SharedAudioRingLayout.OffsetRawBass, f.RawBass);
            WriteF32(s, SharedAudioRingLayout.OffsetRawLowMid, f.RawLowMid);
            WriteF32(s, SharedAudioRingLayout.OffsetRawMid, f.RawMid);
            WriteF32(s, SharedAudioRingLayout.OffsetRawVocal, f.RawVocal);
            WriteF32(s, SharedAudioRingLayout.OffsetRawTreble, f.RawTreble);
            WriteF32(s, SharedAudioRingLayout.OffsetPower, f.Power);
            WriteF32(s, SharedAudioRingLayout.OffsetBass, f.Bass);
            WriteF32(s, SharedAudioRingLayout.OffsetLowMid, f.LowMid);
            WriteF32(s, SharedAudioRingLayout.OffsetMid, f.Mid);
            WriteF32(s, SharedAudioRingLayout.OffsetVocal, f.Vocal);
            WriteF32(s, SharedAudioRingLayout.OffsetTreble, f.Treble);
            WriteF32(s, SharedAudioRingLayout.OffsetRms, f.Rms);
            WriteF32(s, SharedAudioRingLayout.OffsetAgcGain, f.AgcGain);
            WriteF32(s, SharedAudioRingLayout.OffsetBeatStrength, f.BeatStrength);
            WriteF32(s, SharedAudioRingLayout.OffsetLatencyMs, f.LatencyMs);
            uint flags = 0;
            if (f.Beat) flags |= 1;
            if (f.Silent) flags |= 2;
            if (f.BeatDownbeat) flags |= 4;
            WriteU32(s, SharedAudioRingLayout.OffsetFlags, flags);
            for (int i = 0; i < specLen; i++)
                s[SharedAudioRingLayout.OffsetSpectrum + i] = f.Spectrum[i];

            // commit: slot seq first, then header writeSeq
            WriteI64(s, SharedAudioRingLayout.OffsetSeq, seq);
            _view.WriteArray(slotOffset, s, 0, SharedAudioRingLayout.SlotSize);
            _view.Write(SharedAudioRingLayout.HeaderOffsetWriteSeq, seq);
        }

        internal static void WriteF32(byte[] b, int off, float v)
        {
            byte[] tmp = BitConverter.GetBytes(v);
            b[off] = tmp[0]; b[off + 1] = tmp[1]; b[off + 2] = tmp[2]; b[off + 3] = tmp[3];
        }

        internal static void WriteF64(byte[] b, int off, double v)
        {
            byte[] tmp = BitConverter.GetBytes(v);
            Array.Copy(tmp, 0, b, off, 8);
        }

        internal static void WriteI64(byte[] b, int off, long v)
        {
            byte[] tmp = BitConverter.GetBytes(v);
            Array.Copy(tmp, 0, b, off, 8);
        }

        internal static void WriteU32(byte[] b, int off, uint v)
        {
            byte[] tmp = BitConverter.GetBytes(v);
            Array.Copy(tmp, 0, b, off, 4);
        }

        public void Dispose()
        {
            if (_view != null)
            {
                try { _view.Flush(); } catch { }
                _view.Dispose();
                _view = null;
            }
            if (_mmf != null)
            {
                _mmf.Dispose();
                _mmf = null;
            }
            if (_file != null)
            {
                _file.Dispose();
                _file = null;
            }
        }
    }

    public sealed class SharedAudioRingReader : IDisposable
    {
        private MemoryMappedFile _mmf;
        private MemoryMappedViewAccessor _view;
        private FileStream _file;
        private long _lastSeq;
        private readonly byte[] _slot = new byte[SharedAudioRingLayout.SlotSize];

        public int SampleRate { get; private set; }
        public string Path { get; private set; }
        public long LastSeq { get { return _lastSeq; } }

        public SharedAudioRingReader(string path)
        {
            Path = path;
            if (!File.Exists(path)) throw new FileNotFoundException("shared audio ring not found", path);
            _file = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite);
            _mmf = MemoryMappedFile.CreateFromFile(_file, null, SharedAudioRingLayout.TotalSize,
                MemoryMappedFileAccess.ReadWrite, HandleInheritability.None, true);
            _view = _mmf.CreateViewAccessor(0, SharedAudioRingLayout.TotalSize, MemoryMappedFileAccess.ReadWrite);
            uint magic = _view.ReadUInt32(0);
            uint version = _view.ReadUInt32(4);
            if (magic != SharedAudioRingLayout.Magic)
                throw new InvalidDataException("bad magic in shared audio ring at " + path);
            if (version != SharedAudioRingLayout.Version)
                throw new InvalidDataException("unsupported shared audio ring version " + version);
            SampleRate = (int)_view.ReadUInt32(SharedAudioRingLayout.HeaderOffsetSampleRate);
            _lastSeq = _view.ReadInt64(SharedAudioRingLayout.HeaderOffsetWriteSeq);
        }

        /// <summary>Read all frames written since the last successful read (bounded to ring size).</summary>
        public System.Collections.Generic.List<AudioFrame> ReadNewFrames()
        {
            System.Collections.Generic.List<AudioFrame> list = new System.Collections.Generic.List<AudioFrame>();
            if (_view == null) return list;
            long writeSeq = _view.ReadInt64(SharedAudioRingLayout.HeaderOffsetWriteSeq);
            if (writeSeq <= _lastSeq) return list;
            long first = Math.Max(_lastSeq + 1, writeSeq - SharedAudioRingLayout.Capacity + 1);
            for (long seq = first; seq <= writeSeq; seq++)
            {
                int slotIndex = (int)((seq - 1) % SharedAudioRingLayout.Capacity);
                int slotOffset = SharedAudioRingLayout.HeaderSize + slotIndex * SharedAudioRingLayout.SlotSize;
                _view.ReadArray(slotOffset, _slot, 0, SharedAudioRingLayout.SlotSize);
                if (ReadI64(_slot, SharedAudioRingLayout.OffsetSeq) != seq) continue; // torn read, skip
                list.Add(ParseFrame(_slot));
            }
            _lastSeq = writeSeq;
            return list;
        }

        private AudioFrame ParseFrame(byte[] s)
        {
            AudioFrame f = new AudioFrame();
            f.Seq = ReadI64(s, SharedAudioRingLayout.OffsetSeq);
            f.TsEpochMs = ReadI64(s, SharedAudioRingLayout.OffsetTsEpochMs);
            f.TsMonoMs = ReadF64(s, SharedAudioRingLayout.OffsetTsMonoMs);
            f.SamplePos = ReadI64(s, SharedAudioRingLayout.OffsetSamplePos);
            f.SampleRate = (int)ReadU32(s, SharedAudioRingLayout.OffsetSampleRate);
            int specLen = (int)ReadU32(s, SharedAudioRingLayout.OffsetSpectrumLength);
            if (specLen > SharedAudioRingLayout.SpectrumCapacity) specLen = SharedAudioRingLayout.SpectrumCapacity;
            f.RawBass = ReadF32(s, SharedAudioRingLayout.OffsetRawBass);
            f.RawLowMid = ReadF32(s, SharedAudioRingLayout.OffsetRawLowMid);
            f.RawMid = ReadF32(s, SharedAudioRingLayout.OffsetRawMid);
            f.RawVocal = ReadF32(s, SharedAudioRingLayout.OffsetRawVocal);
            f.RawTreble = ReadF32(s, SharedAudioRingLayout.OffsetRawTreble);
            f.Power = ReadF32(s, SharedAudioRingLayout.OffsetPower);
            f.Bass = ReadF32(s, SharedAudioRingLayout.OffsetBass);
            f.LowMid = ReadF32(s, SharedAudioRingLayout.OffsetLowMid);
            f.Mid = ReadF32(s, SharedAudioRingLayout.OffsetMid);
            f.Vocal = ReadF32(s, SharedAudioRingLayout.OffsetVocal);
            f.Treble = ReadF32(s, SharedAudioRingLayout.OffsetTreble);
            f.Rms = ReadF32(s, SharedAudioRingLayout.OffsetRms);
            f.AgcGain = ReadF32(s, SharedAudioRingLayout.OffsetAgcGain);
            f.BeatStrength = ReadF32(s, SharedAudioRingLayout.OffsetBeatStrength);
            f.LatencyMs = ReadF32(s, SharedAudioRingLayout.OffsetLatencyMs);
            uint flags = ReadU32(s, SharedAudioRingLayout.OffsetFlags);
            f.Beat = (flags & 1) != 0;
            f.Silent = (flags & 2) != 0;
            f.BeatDownbeat = (flags & 4) != 0;
            f.Spectrum = new byte[specLen];
            for (int i = 0; i < specLen; i++)
                f.Spectrum[i] = s[SharedAudioRingLayout.OffsetSpectrum + i];
            return f;
        }

        internal static long ReadI64(byte[] b, int off) { return BitConverter.ToInt64(b, off); }
        internal static uint ReadU32(byte[] b, int off) { return BitConverter.ToUInt32(b, off); }
        internal static float ReadF32(byte[] b, int off) { return BitConverter.ToSingle(b, off); }
        internal static double ReadF64(byte[] b, int off) { return BitConverter.ToDouble(b, off); }

        public void Dispose()
        {
            if (_view != null)
            {
                _view.Dispose();
                _view = null;
            }
            if (_mmf != null)
            {
                _mmf.Dispose();
                _mmf = null;
            }
            if (_file != null)
            {
                _file.Dispose();
                _file = null;
            }
        }

        // ------------------------------------------------------------------
        public static bool SelfTest(TextWriter log, string path)
        {
            bool ok = true;
            try
            {
                string testPath = path;
                if (File.Exists(testPath))
                {
                    try { File.Delete(testPath); } catch { testPath = testPath + ".2"; }
                }
                using (SharedAudioRingWriter w = new SharedAudioRingWriter(testPath, 48000))
                using (SharedAudioRingReader r = new SharedAudioRingReader(testPath))
                {
                    AudioFrame f = new AudioFrame();
                    f.SampleRate = 48000;
                    f.Power = 0.5f;
                    f.Bass = 0.25f;
                    f.LowMid = 0.1f;
                    f.Mid = 0.2f;
                    f.Vocal = 0.3f;
                    f.Treble = 0.4f;
                    f.RawBass = 100f;
                    f.Rms = 0.6f;
                    f.AgcGain = 2.5f;
                    f.Beat = true;
                    f.BeatDownbeat = true;
                    f.BeatStrength = 0.7f;
                    f.LatencyMs = 12.5f;
                    f.TsEpochMs = 1700000000123L;
                    f.TsMonoMs = 1234.5;
                    f.SamplePos = 999;
                    f.Spectrum = new byte[1024];
                    for (int i = 0; i < 1024; i++) f.Spectrum[i] = (byte)(i % 256);
                    w.WriteFrame(f);

                    AudioFrame g = new AudioFrame();
                    g.Power = 1.0f;
                    g.Spectrum = new byte[0];
                    g.Silent = true;
                    w.WriteFrame(g);

                    System.Collections.Generic.List<AudioFrame> frames = r.ReadNewFrames();
                    bool countOk = frames.Count == 2;
                    AudioFrame got = frames.Count > 0 ? frames[0] : null;
                    bool contentOk = got != null && Math.Abs(got.Power - 0.5f) < 1e-6
                        && Math.Abs(got.Bass - 0.25f) < 1e-6
                        && Math.Abs(got.RawBass - 100f) < 1e-6
                        && Math.Abs(got.LatencyMs - 12.5f) < 1e-6
                        && got.TsEpochMs == 1700000000123L
                        && Math.Abs(got.TsMonoMs - 1234.5) < 1e-9
                        && got.SamplePos == 999
                        && got.SampleRate == 48000
                        && got.Beat && got.BeatDownbeat && !got.Silent
                        && got.Spectrum.Length == 1024
                        && got.Spectrum[5] == 5
                        && got.Spectrum[1023] == 255;
                    AudioFrame silent = frames.Count > 1 ? frames[1] : null;
                    bool silentOk = silent != null && silent.Silent && silent.Spectrum.Length == 0;
                    bool noDup = r.ReadNewFrames().Count == 0;

                    for (int i = 0; i < 5000; i++)
                    {
                        AudioFrame x = new AudioFrame();
                        x.Power = (float)(i % 100) / 100f;
                        x.Spectrum = new byte[0];
                        w.WriteFrame(x);
                    }
                    System.Collections.Generic.List<AudioFrame> many = r.ReadNewFrames();
                    bool ringOk = many.Count == SharedAudioRingLayout.Capacity
                        && Math.Abs(many[many.Count - 1].Power - (4999 % 100) / 100f) < 1e-6;
                    if (!countOk || !contentOk || !silentOk || !noDup || !ringOk) ok = false;
                    log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                        "selftest: shm ring count={0} content={1} silent={2} noDup={3} wrap={4} -> {5}",
                        countOk, contentOk, silentOk, noDup, ringOk, ok ? "PASS" : "FAIL"));
                }
            }
            catch (Exception ex)
            {
                ok = false;
                log.WriteLine("selftest: shm ring EXCEPTION " + ex.Message + " -> FAIL");
            }
            return ok;
        }
    }
}
