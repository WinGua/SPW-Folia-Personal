// SPDX-License-Identifier: MIT
// Folia-compatible loopback spectrum analyzer (native side).
//
// Contract (docs/protocol.md §5, docs/folia-spec/runtime-contracts.md §7):
//   * 2048-point FFT -> 1024 bins, binHz = sampleRate / 2048  (never hard-code 21.5 Hz)
//   * per-bin byte = WebAudio AnalyserNode getByteFrequencyData equivalent:
//         mag (linear, 0..1 full-scale reference) -> smoothingTimeConstant 0.6 on magnitudes
//         -> dB = 20*log10(mag) -> byte = 255 * (dB - minDecibels) / (maxDecibels - minDecibels)
//         with minDecibels = -100, maxDecibels = -30 (AnalyserNode defaults)
//   * 5 named bands = ARITHMETIC MEAN of raw spectrum bytes over Folia's ranges:
//         bass 20-150, lowMid 150-400, mid 400-1200, vocal 1000-3500, treble 3500-12000 (Hz)
//     (vocal overlaps mid on 1000-1200 exactly like Folia's bridge)
//   * gamma shaping, output scale 0..255 float:
//         shape(v,boost) = (v/255)^boost * 255
//         power = shape((bass+lowMid)/2, 3), bass^1.8, lowMid^2, mid^2, vocal^1.5, treble^2
//   * no signal / pause: spectrum = empty array (frame.Silent = true); the consumer (host page or
//     Shim) writes breath = (sin(nowMs/2000)+1)*20 to power + 5 bands -- see FoliaAudioMapper.
//   * beat: onset detector on the low band emits BeatEvent{ts,strength,isDownbeat}; envelopes are
//     built consumer-side (beatImpact decay 160 ms / downbeatImpact 200 ms, weak floor 0.35).
//
// No dependencies, C# 5 (in-box csc.exe). Reusable: the only public state is per-instance.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace SpwFolia.Audio
{
    /// <summary>One audio frame, shaped for the Folia page contract.</summary>
    public sealed class AudioFrame
    {
        public long Seq;
        public long TsEpochMs;
        public double TsMonoMs;
        public long SamplePos;
        public int SampleRate;

        /// <summary>1024 (FftSize/2) raw AnalyserNode-scale bytes, 0..255. Length == 0 means "no signal" (pause/ended/no device data).</summary>
        public byte[] Spectrum;

        // Raw (pre-gamma) arithmetic-mean band levels, 0..255.
        public float RawBass;
        public float RawLowMid;
        public float RawMid;
        public float RawVocal;
        public float RawTreble;

        // Gamma-shaped levels ready for the protocol audio message, 0..255 float.
        public float Power;
        public float Bass;
        public float LowMid;
        public float Mid;
        public float Vocal;
        public float Treble;

        public float Rms;        // 0..1 time-domain RMS of the analysed window (scaled by AGC gain)
        public float AgcGain;    // 1.0 when auto-gain is disabled (default)
        public bool Silent;      // true => Spectrum.Length == 0, bands/power all 0
        public bool Beat;        // last frame triggered an onset (diagnostic; BeatEvent is authoritative)
        public bool BeatDownbeat;
        public float BeatStrength;
        public float LatencyMs;  // capture timestamp -> emit timestamp, diagnostics only

        public AudioFrame()
        {
            Spectrum = new byte[0];
            AgcGain = 1f;
        }

        public static AudioFrame SilentFrame()
        {
            AudioFrame f = new AudioFrame();
            f.Silent = true;
            f.Spectrum = new byte[0];
            return f;
        }

        /// <summary>0..255 float band array in protocol order: bass, lowMid, mid, vocal, treble.</summary>
        public float[] GetShapedBands()
        {
            return new float[] { Bass, LowMid, Mid, Vocal, Treble };
        }
    }

    /// <summary>A beat onset event (envelopes are built by the consumer).</summary>
    public struct BeatEvent
    {
        public long Seq;
        public long TsEpochMs;
        public double TsMonoMs;
        public float Strength;    // 0..1
        public bool IsDownbeat;   // heuristic: every 4th onset once the inter-beat interval is stable
        public double IbiMs;      // estimated inter-beat interval (0 when unknown)
    }

    public sealed class SpectrumOptions
    {
        public bool EnableSmoothing = true;          // AnalyserNode smoothingTimeConstant
        public double SmoothingTimeConstant = 0.6;   // Folia bridge: analyser.smoothingTimeConstant = 0.6
        public bool EnableAgc = false;               // OFF by default: bytes must stay comparable to WebAudio
        public int TargetFps = 60;                   // only used for hop / docs; frames drive smoothing
        public int FftSize = 2048;                   // AnalyserNode fftSize -> 1024 bins
        public double MinDecibels = -100.0;          // AnalyserNode default
        public double MaxDecibels = -30.0;           // AnalyserNode default
        public double SilenceRms = 2e-5;             // ~-94 dBFS; needs SilenceHoldSec sustained to go Silent
        public double SilenceHoldSec = 0.30;

        // Folia's named band ranges (Hz), inclusive of the final bin; vocal overlaps mid by design.
        public static readonly string[] BandNames = new string[] { "bass", "lowMid", "mid", "vocal", "treble" };
        public static readonly double[][] BandRangesHz = new double[][] {
            new double[] { 20.0, 150.0 },
            new double[] { 150.0, 400.0 },
            new double[] { 400.0, 1200.0 },
            new double[] { 1000.0, 3500.0 },
            new double[] { 3500.0, 12000.0 }
        };
        public static readonly double[] BandBoosts = new double[] { 1.8, 2.0, 2.0, 1.5, 2.0 };
    }

    public sealed class SpectrumAnalyzer
    {
        private const double NoiseFloor = 1e-5;
        private const double AgcAttackSec = 0.25;
        private const double AgcReleaseSec = 4.0;
        private const double AgcTargetRatio = 1.25;
        private const double AgcMaxGain = 16.0;
        private const double AgcMinGain = 0.25;

        // Beat detector (low-band onset, 120 ms refractory).
        private const int BeatHistoryFrames = 43;    // ~0.7 s @ 60 Hz
        private const double BeatRefractorySec = 0.120;
        private const double BeatThresholdMul = 1.25;
        private const double BeatThresholdFloor = 6.0;  // in byte scale 0..255
        private const double BeatMinEnergy = 8.0;
        private const double BeatMinHistoryMean = 4.0;

        public int SampleRate { get; private set; }
        public int FftSize { get; private set; }
        public int BinCount { get; private set; }
        public double BinHz { get; private set; }
        public SpectrumOptions Options { get; private set; }

        private readonly int _namedBandCount = SpectrumOptions.BandRangesHz.Length;
        private readonly double[] _hann;
        private readonly double _hannSum;
        private readonly double[] _re;
        private readonly double[] _im;
        private readonly double[] _amp;
        private readonly double[] _smoothMag;
        private readonly byte[] _byteBins;
        private readonly byte[] _rawByteBins;
        private readonly int[] _bandLo;
        private readonly int[] _bandHi;
        private readonly double[] _beatHistory;
        private int _beatHistoryCount;
        private int _beatHistoryPos;
        private double _lastBeatSec = -1000.0;
        private double _ibiEma = 0.0;
        private int _beatsSinceDownbeat = 0;
        private int _beatCount = 0;

        private double _refRms = NoiseFloor;
        private double _timeSec;
        private int _silentFrames;

        public SpectrumAnalyzer(int sampleRate, SpectrumOptions options)
        {
            if (sampleRate < 8000 || sampleRate > 384000)
                throw new ArgumentOutOfRangeException("sampleRate", "unsupported sample rate " + sampleRate);
            Options = options ?? new SpectrumOptions();
            SampleRate = sampleRate;

            // WebAudio fidelity: fftSize stays 2048 for every sample rate, so binHz = rate/2/1024.
            FftSize = Options.FftSize < 512 ? 2048 : Options.FftSize;
            if ((FftSize & (FftSize - 1)) != 0) throw new ArgumentException("FftSize must be a power of two", "options");
            BinCount = FftSize / 2;
            BinHz = (double)SampleRate / FftSize;

            _hann = new double[FftSize];
            double sum = 0.0;
            for (int i = 0; i < FftSize; i++)
            {
                double w = 0.5 * (1.0 - Math.Cos(2.0 * Math.PI * i / (FftSize - 1)));
                _hann[i] = w;
                sum += w;
            }
            _hannSum = sum;

            _re = new double[FftSize];
            _im = new double[FftSize];
            _amp = new double[BinCount];
            _smoothMag = new double[BinCount];
            _byteBins = new byte[BinCount];
            _rawByteBins = new byte[BinCount];
            _beatHistory = new double[BeatHistoryFrames];

            _bandLo = new int[_namedBandCount];
            _bandHi = new int[_namedBandCount];
            for (int b = 0; b < _namedBandCount; b++)
                BinRange(SpectrumOptions.BandRangesHz[b][0], SpectrumOptions.BandRangesHz[b][1],
                         out _bandLo[b], out _bandHi[b]);
        }

        /// <summary>Map an Hz range to inclusive FFT bin indices, matching Folia's floor(hz/binHz) bridge.</summary>
        public void BinRange(double hzLo, double hzHi, out int lo, out int hi)
        {
            int maxBin = BinCount - 1;
            lo = (int)Math.Floor(hzLo / BinHz);
            hi = (int)Math.Floor(hzHi / BinHz);
            if (lo < 0) lo = 0;
            if (hi > maxBin) hi = maxBin;
            if (hi < lo) hi = lo;
        }

        public void Reset()
        {
            _refRms = NoiseFloor;
            _timeSec = 0.0;
            _silentFrames = 0;
            for (int i = 0; i < _smoothMag.Length; i++) _smoothMag[i] = 0.0;
            _beatHistoryCount = 0;
            _beatHistoryPos = 0;
            _lastBeatSec = -1000.0;
            _ibiEma = 0.0;
            _beatsSinceDownbeat = 0;
            _beatCount = 0;
        }

        /// <summary>
        /// Analyze the newest FftSize mono samples (time-domain, -1..1). dtSeconds is real time since
        /// the previous call (smoothing / silence hold only; the byte conversion is per-frame like
        /// AnalyserNode's getByteFrequencyData call).
        /// </summary>
        public AudioFrame Process(float[] window, double dtSeconds)
        {
            if (window == null || window.Length != FftSize)
                throw new ArgumentException("window must have exactly FftSize samples", "window");
            if (dtSeconds < 0.001) dtSeconds = 0.001;
            if (dtSeconds > 0.250) dtSeconds = 0.250;
            _timeSec += dtSeconds;

            // ---- time-domain RMS + optional AGC ----
            double sumSq = 0.0;
            for (int i = 0; i < FftSize; i++)
            {
                double s = window[i];
                sumSq += s * s;
            }
            double rms = Math.Sqrt(sumSq / FftSize);

            double gain = 1.0;
            if (Options.EnableAgc)
            {
                if (rms > _refRms)
                    _refRms += (rms - _refRms) * (1.0 - Math.Exp(-dtSeconds / AgcAttackSec));
                else
                    _refRms += (rms - _refRms) * (1.0 - Math.Exp(-dtSeconds / AgcReleaseSec));
                if (_refRms < NoiseFloor) _refRms = NoiseFloor;
                gain = 1.0 / (_refRms * AgcTargetRatio);
                if (gain > AgcMaxGain) gain = AgcMaxGain;
                if (gain < AgcMinGain) gain = AgcMinGain;
            }
            else
            {
                _refRms = NoiseFloor;
            }

            // ---- no-signal gate: Folia gets an empty spectrum and the consumer breathes ----
            if (rms < Options.SilenceRms) _silentFrames++;
            else _silentFrames = 0;
            if (_silentFrames * dtSeconds >= Options.SilenceHoldSec)
            {
                for (int i = 0; i < _smoothMag.Length; i++) _smoothMag[i] = 0.0;
                return SilentResult();
            }

            // ---- FFT ----
            for (int i = 0; i < FftSize; i++)
            {
                _re[i] = window[i] * _hann[i];
                _im[i] = 0.0;
            }
            Fft(_re, _im);

            // ---- linear magnitude, normalised so a bin-centred full-scale sine == 1.0 ----
            double scale = 2.0 * gain / _hannSum;
            _amp[0] = Math.Abs(_re[0]) * gain / _hannSum;   // DC (single-sided convention)
            for (int k = 1; k < BinCount; k++)
                _amp[k] = scale * Math.Sqrt(_re[k] * _re[k] + _im[k] * _im[k]);

            // ---- AnalyserNode smoothingTimeConstant (per getByteFrequencyData call) ----
            double tau = Options.EnableSmoothing ? Options.SmoothingTimeConstant : 0.0;
            if (tau < 0.0) tau = 0.0;
            if (tau > 0.95) tau = 0.95;
            double dbRange = Options.MaxDecibels - Options.MinDecibels;
            if (dbRange <= 0.0) dbRange = 70.0;
            for (int k = 0; k < BinCount; k++)
            {
                double mag = _smoothMag[k] = tau * _smoothMag[k] + (1.0 - tau) * _amp[k];
                _byteBins[k] = ToByte(mag, dbRange);
                // Unsmoothed byte (energy of this frame only) is used by the beat onset detector:
                // AnalyserNode smoothing would keep a single kick above the threshold for several
                // frames and produce duplicate onsets ~120 ms apart.
                _rawByteBins[k] = ToByte(_amp[k], dbRange);
            }

            // ---- named bands: arithmetic mean of raw bytes over Folia's ranges ----
            double[] raw = new double[_namedBandCount];
            for (int b = 0; b < _namedBandCount; b++) raw[b] = MeanByte(_bandLo[b], _bandHi[b]);

            AudioFrame f = new AudioFrame();
            f.SampleRate = SampleRate;
            f.Spectrum = new byte[BinCount];
            Array.Copy(_byteBins, f.Spectrum, BinCount);
            f.RawBass = (float)raw[0];
            f.RawLowMid = (float)raw[1];
            f.RawMid = (float)raw[2];
            f.RawVocal = (float)raw[3];
            f.RawTreble = (float)raw[4];
            f.Bass = (float)FoliaAudioMapper.Shape(raw[0], SpectrumOptions.BandBoosts[0]);
            f.LowMid = (float)FoliaAudioMapper.Shape(raw[1], SpectrumOptions.BandBoosts[1]);
            f.Mid = (float)FoliaAudioMapper.Shape(raw[2], SpectrumOptions.BandBoosts[2]);
            f.Vocal = (float)FoliaAudioMapper.Shape(raw[3], SpectrumOptions.BandBoosts[3]);
            f.Treble = (float)FoliaAudioMapper.Shape(raw[4], SpectrumOptions.BandBoosts[4]);
            f.Power = (float)FoliaAudioMapper.Shape((raw[0] + raw[1]) * 0.5, 3.0);
            f.Rms = (float)Math.Min(1.0, rms * gain);
            f.AgcGain = (float)gain;
            f.Silent = false;

            // ---- beat onset on unsmoothed low-band energy (visual-scale, no AGC distortion) ----
            double strength;
            bool downbeat;
            DetectBeat(MeanBytes(_rawByteBins, _bandLo[0], _bandHi[0]), dtSeconds, out strength, out downbeat);
            f.Beat = strength > 0.0;
            f.BeatStrength = (float)Math.Min(1.0, strength);
            f.BeatDownbeat = downbeat;
            return f;
        }

        /// <summary>Estimated inter-beat interval in ms (0 while unknown).</summary>
        public double IbiMs { get { return _ibiEma; } }

        /// <summary>All raw spectrum bins (0..255) from the last processed frame.</summary>
        public byte[] GetByteBins()
        {
            byte[] copy = new byte[BinCount];
            Array.Copy(_byteBins, copy, BinCount);
            return copy;
        }

        public static double Shape(double value, double boost)
        {
            return FoliaAudioMapper.Shape(value, boost);
        }

        private AudioFrame SilentResult()
        {
            AudioFrame f = AudioFrame.SilentFrame();
            f.SampleRate = SampleRate;
            f.Spectrum = new byte[0];
            f.Silent = true;
            return f;
        }

        private double MeanByte(int lo, int hi)
        {
            return MeanBytes(_byteBins, lo, hi);
        }

        private static double MeanBytes(byte[] bins, int lo, int hi)
        {
            if (hi < lo) return 0.0;
            int sum = 0;
            for (int k = lo; k <= hi; k++) sum += bins[k];
            return (double)sum / (hi - lo + 1);
        }

        private byte ToByte(double mag, double dbRange)
        {
            double db = 20.0 * Math.Log10(mag + 1e-12);
            double v = (db - Options.MinDecibels) / dbRange * 255.0;
            if (v < 0.0) v = 0.0;
            if (v > 255.0) v = 255.0;
            return (byte)(v + 0.5);
        }

        private void DetectBeat(double bassByte, double dtSeconds, out double strength, out bool downbeat)
        {
            strength = 0.0;
            downbeat = false;
            double mean = 0.0;
            for (int i = 0; i < _beatHistoryCount; i++) mean += _beatHistory[i];
            if (_beatHistoryCount > 0) mean /= _beatHistoryCount;

            double threshold = mean * BeatThresholdMul + BeatThresholdFloor;
            bool hit = bassByte > threshold && bassByte > BeatMinEnergy
                       && mean > BeatMinHistoryMean
                       && _timeSec - _lastBeatSec >= BeatRefractorySec;
            if (hit)
            {
                strength = (bassByte - threshold) / Math.Max(1.0, 255.0 - threshold);
                if (strength > 1.0) strength = 1.0;
                if (strength < 0.05) strength = 0.05;
                if (_lastBeatSec > -1000.0 + 0.5)
                {
                    double ibi = (_timeSec - _lastBeatSec) * 1000.0;
                    if (ibi >= 250.0 && ibi <= 2000.0)
                        _ibiEma = _ibiEma <= 0.0 ? ibi : _ibiEma * 0.7 + ibi * 0.3;
                }
                _lastBeatSec = _timeSec;
                _beatCount++;
                _beatsSinceDownbeat++;
                if (_beatsSinceDownbeat >= 4 && _ibiEma >= 250.0)
                {
                    downbeat = true;
                    _beatsSinceDownbeat = 0;
                }
            }
            PushBeatHistory(bassByte);
        }

        private void PushBeatHistory(double value)
        {
            _beatHistory[_beatHistoryPos] = value;
            _beatHistoryPos = (_beatHistoryPos + 1) % BeatHistoryFrames;
            if (_beatHistoryCount < BeatHistoryFrames) _beatHistoryCount++;
        }

        /// <summary>In-place iterative radix-2 Cooley-Tukey FFT (no dependencies).</summary>
        public static void Fft(double[] re, double[] im)
        {
            int n = re.Length;
            if (n != im.Length) throw new ArgumentException("re/im length mismatch");
            if ((n & (n - 1)) != 0) throw new ArgumentException("FFT length must be a power of two");

            int j = 0;
            for (int i = 0; i < n - 1; i++)
            {
                if (i < j)
                {
                    double tr = re[i]; re[i] = re[j]; re[j] = tr;
                    double ti = im[i]; im[i] = im[j]; im[j] = ti;
                }
                int m = n >> 1;
                while (m >= 1 && j >= m)
                {
                    j -= m;
                    m >>= 1;
                }
                j += m;
            }
            for (int len = 2; len <= n; len <<= 1)
            {
                double ang = -2.0 * Math.PI / len;
                double wRe = Math.Cos(ang);
                double wIm = Math.Sin(ang);
                for (int i = 0; i < n; i += len)
                {
                    double curRe = 1.0;
                    double curIm = 0.0;
                    int half = len >> 1;
                    for (int k = 0; k < half; k++)
                    {
                        int a = i + k;
                        int b = a + half;
                        double tRe = re[b] * curRe - im[b] * curIm;
                        double tIm = re[b] * curIm + im[b] * curRe;
                        re[b] = re[a] - tRe;
                        im[b] = im[a] - tIm;
                        re[a] += tRe;
                        im[a] += tIm;
                        double nextRe = curRe * wRe - curIm * wIm;
                        curIm = curRe * wIm + curIm * wRe;
                        curRe = nextRe;
                    }
                }
            }
        }

        // ------------------------------------------------------------------
        // Offline self-test: contract numbers, calibration curve, band mapping, silence, beat, FFT.
        // Returns the number of failed checks (0 = pass).
        // ------------------------------------------------------------------
        public static int RunSelfTest(TextWriter log, int sampleRate)
        {
            int failures = 0;
            SpectrumOptions opt = new SpectrumOptions();
            opt.EnableSmoothing = false;
            opt.EnableAgc = false;
            SpectrumAnalyzer an = new SpectrumAnalyzer(sampleRate, opt);
            log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                "selftest: sampleRate={0} fft={1} bins={2} binHz={3:F4} bands=5",
                sampleRate, an.FftSize, an.BinCount, an.BinHz));

            // 1) bin-centred tone -> visible in the right raw bins + calibration curve (byte vs dBFS)
            double[] freqs = new double[] { 60.0, 125.0, 1000.0, 4000.0, 10000.0 };
            foreach (double freq in freqs)
            {
                float[] w = Tone(an, freq, 0.5);
                AudioFrame f = null;
                for (int k = 0; k < 4; k++) f = an.Process(w, 1.0 / 60.0);
                byte[] bins = an.GetByteBins();

                int peakBin = 1;
                for (int k = 2; k < bins.Length; k++) if (bins[k] > bins[peakBin]) peakBin = k;
                double peakHz = peakBin * an.BinHz;
                bool binOk = Math.Abs(peakHz - freq) <= 2.0 * an.BinHz && bins[peakBin] >= 250;

                double rawHit = f.RawBass;
                if (freq >= 1000.0) rawHit = f.RawMid;
                if (freq >= 3500.0) rawHit = f.RawTreble;
                bool bandOk = rawHit > 0.0;
                bool shapedOk = InRange(f.Bass) && InRange(f.LowMid) && InRange(f.Mid)
                                && InRange(f.Vocal) && InRange(f.Treble) && InRange(f.Power);
                bool specOk = f.Spectrum != null && f.Spectrum.Length == an.BinCount;
                string status = (binOk && bandOk && shapedOk && specOk) ? "PASS" : "FAIL";
                if (status == "FAIL") failures++;
                log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                    "selftest: tone {0} Hz -> peakBin {1} ({2:F1} Hz, byte {3}) rawMid {4:F1} shapedMid {5:F1} power {6:F1} {7}",
                    freq, peakBin, peakHz, bins[peakBin], f.RawMid, f.Mid, f.Power, status));
            }

            // 2) calibration: bin-centred quiet tone, expected byte = 255*(20log10(A)+100)/70
            double[] amps = new double[] { 0.001, 0.003, 0.01 };
            foreach (double amp in amps)
            {
                int k = 43;                                  // bin centre at 1007.8 Hz @48k / 926.5 Hz @44.1k
                double freq = k * an.BinHz;
                float[] w = Tone(an, freq, amp);
                AudioFrame f = null;
                for (int n = 0; n < 6; n++) f = an.Process(w, 1.0 / 60.0);
                byte[] bins = an.GetByteBins();
                int expByte = ExpectedByte(amp);
                int got = bins[k];
                bool ok = Math.Abs(got - expByte) <= 2;
                if (!ok) failures++;
                log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                    "selftest: calibration amp={0} ({1:F2} dBFS) expectedByte {2} gotByte {3} {4}",
                    amp, 20.0 * Math.Log10(amp), expByte, got, ok ? "PASS" : "FAIL"));
            }

            // 3) gamma (shape) table. Values are pow((raw/255), boost) * 255 computed independently.
            //    NOTE: the lead brief quoted raw 40->8.9, 80->71.7, 120->243 for power; those numbers are
            //    NOT shape(x,3) (shape(120,3)=26.6). This file implements the explicitly specified
            //    formula; see docs/audio-timeline.md §contract-parity-open-questions for the flag.
            failures += CheckShape(log, 100.0, 1.8, 47.29, 0.3);
            failures += CheckShape(log, 150.0, 1.8, 98.12, 0.4);
            failures += CheckShape(log, 100.0, 2.0, 39.22, 0.3);
            failures += CheckShape(log, 150.0, 2.0, 88.20, 0.4);
            failures += CheckShape(log, 40.0, 3.0, 0.984, 0.02);
            failures += CheckShape(log, 80.0, 3.0, 7.872, 0.05);
            failures += CheckShape(log, 120.0, 3.0, 26.57, 0.1);

            // 4) silence gate -> Silent frame with an empty spectrum
            {
                float[] w = new float[an.FftSize];
                AudioFrame f = null;
                for (int k = 0; k < 40; k++) f = an.Process(w, 1.0 / 60.0);
                bool ok = f.Silent && f.Spectrum.Length == 0 && f.Power == 0f && f.Bass == 0f;
                if (!ok) failures++;
                log.WriteLine("selftest: silence gate (empty spectrum) -> " + (ok ? "PASS" : "FAIL"));
            }

            // 5) beat detector + downbeat heuristic on a synthetic 120 BPM kick track
            {
                SpectrumAnalyzer beatAn = new SpectrumAnalyzer(sampleRate, new SpectrumOptions());
                int seconds = 8;
                int total = sampleRate * seconds;
                float[] signal = new float[total];
                int kickLen = (int)(0.08 * sampleRate);
                for (int beat = 0; beat < seconds * 2; beat++)
                {
                    int start = beat * sampleRate / 2;
                    for (int i = 0; i < kickLen && start + i < total; i++)
                    {
                        double env = Math.Exp(-3.0 * i / kickLen);
                        signal[start + i] += (float)(0.6 * env * Math.Sin(2.0 * Math.PI * 60.0 * i / sampleRate));
                    }
                }
                int hop = sampleRate / 60;
                int frames = (total - beatAn.FftSize) / hop;
                int beats = 0, downbeats = 0;
                float[] window = new float[beatAn.FftSize];
                List<AudioFrame> outFrames = new List<AudioFrame>();
                for (int fi = 0; fi < frames; fi++)
                {
                    Array.Copy(signal, fi * hop, window, 0, beatAn.FftSize);
                    AudioFrame fr = beatAn.Process(window, (double)hop / sampleRate);
                    outFrames.Add(fr);
                    if (fr.Beat) beats++;
                    if (fr.BeatDownbeat) downbeats++;
                }
                bool countOk = beats >= seconds * 2 - 3 && beats <= seconds * 2 + 1;
                bool downOk = downbeats >= 2 && downbeats <= 4;
                if (!countOk || !downOk) failures++;
                log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                    "selftest: beat detector -> {0} beats, {1} downbeats in {2}s ({3} frames) {4}",
                    beats, downbeats, seconds, outFrames.Count,
                    (countOk && downOk) ? "PASS" : "FAIL"));
            }

            // 6) FFT correctness vs brute-force DFT
            {
                double[] re = new double[256];
                double[] im = new double[256];
                Random rng = new Random(12345);
                for (int i = 0; i < re.Length; i++) { re[i] = rng.NextDouble() * 2.0 - 1.0; im[i] = rng.NextDouble() * 2.0 - 1.0; }
                double[] r0 = (double[])re.Clone();
                double[] i0 = (double[])im.Clone();
                Fft(re, im);
                double maxErr = 0.0;
                for (int k = 0; k < 16; k++)
                {
                    double sumRe = 0.0, sumIm = 0.0;
                    for (int n = 0; n < r0.Length; n++)
                    {
                        double ang = -2.0 * Math.PI * k * n / r0.Length;
                        sumRe += r0[n] * Math.Cos(ang) - i0[n] * Math.Sin(ang);
                        sumIm += r0[n] * Math.Sin(ang) + i0[n] * Math.Cos(ang);
                    }
                    maxErr = Math.Max(maxErr, Math.Abs(sumRe - re[k]));
                    maxErr = Math.Max(maxErr, Math.Abs(sumIm - im[k]));
                }
                bool ok = maxErr < 1e-8;
                if (!ok) failures++;
                log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                    "selftest: FFT vs brute-force DFT maxErr={0:E2} {1}", maxErr, ok ? "PASS" : "FAIL"));
            }

            // 7) breadth: named band ranges map to expected bins for this sample rate
            {
                int bassLo = (int)Math.Floor(20.0 / an.BinHz);
                int bassHi = (int)Math.Floor(150.0 / an.BinHz);
                int trebleHi = (int)Math.Floor(12000.0 / an.BinHz);
                bool ok = bassLo < bassHi && trebleHi < an.BinCount;
                if (!ok) failures++;
                log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                    "selftest: band bins bass[{0}..{1}] trebleHi={2} bins={3} {4}",
                    bassLo, bassHi, trebleHi, an.BinCount, ok ? "PASS" : "FAIL"));
            }

            return failures;
        }

        private static bool InRange(double v) { return v >= 0.0 && v <= 255.0; }

        private static int CheckShape(TextWriter log, double raw, double boost, double expected, double tolerance)
        {
            double got = FoliaAudioMapper.Shape(raw, boost);
            bool ok = Math.Abs(got - expected) <= tolerance;
            if (!ok) log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                "selftest: shape({0},{1}) expected {2:F3} got {3:F3} FAIL", raw, boost, expected, got));
            else log.WriteLine(string.Format(CultureInfo.InvariantCulture,
                "selftest: shape({0},{1}) = {2:F3} PASS", raw, boost, got));
            return ok ? 0 : 1;
        }

        /// <summary>AnalyserNode byte mapping for a bin-centred sine of amplitude amp (full-scale = 1.0).</summary>
        public static int ExpectedByte(double amp)
        {
            double db = 20.0 * Math.Log10(amp);
            double v = (db + 100.0) / 70.0 * 255.0;
            if (v < 0.0) v = 0.0;
            if (v > 255.0) v = 255.0;
            return (int)(v + 0.5);
        }

        private static float[] Tone(SpectrumAnalyzer an, double freq, double amp)
        {
            float[] w = new float[an.FftSize];
            for (int i = 0; i < w.Length; i++)
                w[i] = (float)(amp * Math.Sin(2.0 * Math.PI * freq * i / an.SampleRate));
            return w;
        }
    }
}
