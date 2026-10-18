// SPDX-License-Identifier: MIT
// LoopbackAnalyzer: reusable WASAPI system-loopback -> Folia-contract audio analyzer.
//
//   Owns the capture thread, keeps a rolling mono sample ring, analyzes one 2048-sample window per
//   1/TargetFps and publishes an AudioFrame (spectrum 1024 raw bytes + shaped 0..255 bands) through
//   TryGetLatest() (pull model for the host's 60 Hz tick), an optional ISpectrumSink, events and an
//   optional diagnostic shared-memory ring. Beat onsets are queued as BeatEvent for TryDequeueBeat().
//
// Embedding contract (spw-folia-host.exe, C# 5, namespace SpwFolia.Audio, no Main, no UI deps):
//   LoopbackOptions o = new LoopbackOptions();
//   LoopbackAnalyzer a = new LoopbackAnalyzer(o);          // or (o, sink)
//   a.Start();
//   AudioFrame f; if (a.TryGetLatest(out f)) post(f);
//   BeatEvent b; while (a.TryDequeueBeat(out b)) postBeat(b);
//   a.Stop(); a.Dispose();
//
// Standalone harness: Program.cs.
using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace SpwFolia.Audio
{
    /// <summary>Optional push-model consumer. Both callbacks run on the capture thread: never block.</summary>
    public interface ISpectrumSink
    {
        void OnAudioFrame(AudioFrame frame);
        void OnBeat(BeatEvent beat);
    }

    public sealed class LoopbackOptions
    {
        public int TargetFps = 60;
        public int PollIntervalMs = 3;                 // capture poll back-off when no packet is ready
        public int DeviceRole = AudioConstants.eConsole;
        public long BufferDurationHns = 10L * AudioConstants.HNS_PER_SECOND; // 1 s shared buffer
        public bool EmitSilentFrames = true;           // publish Silent frames (host turns them into breath payloads)
        public bool EnableSmoothing = true;            // AnalyserNode smoothingTimeConstant 0.6
        public bool EnableAgc = false;                 // OFF: bytes must stay comparable to WebAudio
        public string SharedMemoryPath = null;         // optional diagnostics; null = disabled (host runs in-process)
        public bool FollowDefaultDevice = true;        // reopen capture when the default render device changes
        public double SilenceTimeoutSec = 0.25;        // no new packet for this long => emit Silent frames
    }

    public sealed class LoopbackStatistics
    {
        public long FramesEmitted;
        public long SilentFrames;
        public long DataPackets;
        public long EmptyDrains;
        public long TotalMonoSamples;
        public long Discontinuities;
        public long FramesAnalyzed;
        public long BeatCount;
        public long DownbeatCount;
        public double ElapsedMs;
        public double MeanLatencyMs;
        public double MaxLatencyMs;
        public long LatencySamples;
        public double LatencySumMs;
        public string DeviceId;
        public string FormatText;
        public int SampleRate;
        public int FftSize;
        public int SpectrumBins;
        public string Error;
        public long ReopenCount;
        // latency diagnostics: raw = QPC-based age before clamping to [0, 500] ms
        public long QpcPackets;
        public double RawLatencyMinMs = double.MaxValue;
        public double RawLatencyMaxMs = double.MinValue;
        public double RawLatencySumMs;
        public long RawLatencySamples;
        // engine lead = how far the packet QPC end timestamp is ahead of the local QPC clock
        public double QpcLeadMinMs = double.MaxValue;
        public double QpcLeadMaxMs = double.MinValue;
        public double QpcLeadSumMs;
        public long QpcLeadSamples;
        // raw work accounting (Stopwatch ticks) for CPU breakdown evidence
        public long DrainTicks;
        public long AnalyzeTicks;
        public long LoopIterations;

        public void AddLatency(double ms)
        {
            if (ms < 0) ms = 0;
            LatencySumMs += ms;
            LatencySamples++;
            if (ms > MaxLatencyMs) MaxLatencyMs = ms;
            MeanLatencyMs = LatencySamples > 0 ? LatencySumMs / LatencySamples : 0.0;
        }

        public void AddRawLatency(double rawMs)
        {
            if (RawLatencySamples == 0 || rawMs < RawLatencyMinMs) RawLatencyMinMs = rawMs;
            if (RawLatencySamples == 0 || rawMs > RawLatencyMaxMs) RawLatencyMaxMs = rawMs;
            RawLatencySumMs += rawMs;
            RawLatencySamples++;
        }

        public void AddQpcLead(double leadMs)
        {
            if (QpcLeadSamples == 0 || leadMs < QpcLeadMinMs) QpcLeadMinMs = leadMs;
            if (QpcLeadSamples == 0 || leadMs > QpcLeadMaxMs) QpcLeadMaxMs = leadMs;
            QpcLeadSumMs += leadMs;
            QpcLeadSamples++;
        }
    }

    public sealed class LoopbackAnalyzer : IDisposable
    {
        private const int BeatQueueLimit = 256;

        private readonly LoopbackOptions _options;
        private ISpectrumSink _sink;
        private WasapiLoopbackCapture _capture;
        private SpectrumAnalyzer _analyzer;
        private SharedAudioRingWriter _writer;
        private Thread _thread;
        private ManualResetEventSlim _startedEvent;
        private Exception _startError;
        private volatile bool _running;
        private volatile AudioFrame _latest;
        private readonly ConcurrentQueue<BeatEvent> _beats = new ConcurrentQueue<BeatEvent>();
        private readonly object _stateLock = new object();

        private float[] _ring;
        private int _ringPos;
        private long _totalSamples;
        private float[] _windowBuf;
        private float[] _mono;
        private float[] _pktFloat;
        private short[] _pktShort;
        private int[] _pktInt;
        private byte[] _pktByte;

        private long _seq;
        private long _startTicks;
        private long _lastEmitTicks;
        private long _lastDataTicks;
        private long _lastAnalyzeTicks;
        private long _lastPacketArrivalTicks;
        private double _lastPacketQpcEnd100ns;
        private bool _haveQpc;
        private bool _timerPeriodActive;
        private long _silenceStartTicks;
        private long _nextDeviceCheckTicks;

        private long _lastPacketSamplePos = -1;

        public event Action<AudioFrame> FrameReady;
        public event Action<BeatEvent> BeatReady;
        public event Action<Exception> CaptureError;

        public LoopbackStatistics Stats { get; private set; }
        public bool IsRunning { get { return _running; } }
        public int SampleRate { get { return _analyzer != null ? _analyzer.SampleRate : 0; } }
        public int FftSize { get { return _analyzer != null ? _analyzer.FftSize : 0; } }

        public LoopbackAnalyzer(LoopbackOptions options)
            : this(options, null)
        {
        }

        public LoopbackAnalyzer(LoopbackOptions options, ISpectrumSink sink)
        {
            _options = options ?? new LoopbackOptions();
            _sink = sink;
            Stats = new LoopbackStatistics();
        }

        /// <summary>
        /// Starts capture. All COM/WASAPI objects are created on the analyzer's own MTA capture
        /// thread, so Start() is safe to call from a WinForms STA UI thread. Throws if no default
        /// render endpoint exists or the capture client cannot be initialized.
        /// </summary>
        public void Start()
        {
            lock (_stateLock)
            {
                if (_thread != null || _running) throw new InvalidOperationException("already running");
                Stats = new LoopbackStatistics();
                _latest = null;
                _seq = 0;
                BeatEvent discard;
                while (_beats.TryDequeue(out discard)) { }
                _startError = null;
                _startedEvent = new ManualResetEventSlim(false);

                // The WASAPI loopback engine on many systems delivers packets only every 10-30 ms.
                // Without 1 ms timer resolution Thread.Sleep(3) is rounded up to the default 15.6 ms
                // tick, which coalesces emissions to ~30 fps (measured). timeBeginPeriod(1) makes the
                // capture loop able to wake up between packets and emit at the requested 60 Hz.
                if (!_timerPeriodActive)
                {
                    WinmmTimer.Begin1ms();
                    _timerPeriodActive = true;
                }

                Thread t = new Thread(CaptureThreadProc);
                t.IsBackground = true;
                t.Name = "spw-folia-audio-capture";
                t.Priority = ThreadPriority.AboveNormal;
                try { t.SetApartmentState(ApartmentState.MTA); } catch { }
                _thread = t;
                t.Start();

                bool ready = _startedEvent.Wait(5000);
                Exception startError = _startError;
                if (!ready || startError != null)
                {
                    // Failed to initialize: join and release everything before reporting the error.
                    _running = false;
                    try { t.Join(2000); } catch { }
                    _thread = null;
                    if (_capture != null) { try { _capture.Dispose(); } catch { } _capture = null; }
                    if (_writer != null) { try { _writer.Dispose(); } catch { } _writer = null; }
                    if (_timerPeriodActive) { WinmmTimer.End1ms(); _timerPeriodActive = false; }
                    if (!ready && startError == null)
                        throw new TimeoutException("loopback capture did not start within 5 s");
                    if (startError != null)
                        throw new InvalidOperationException("loopback capture start failed: " + startError.Message, startError);
                    return;
                }
            }
        }

        private void CaptureThreadProc()
        {
            try
            {
                _capture = WasapiLoopbackCapture.Open(_options.DeviceRole, _options.BufferDurationHns);
                OpenAnalyzerForCurrentFormat();
                if (_options.SharedMemoryPath != null)
                    _writer = new SharedAudioRingWriter(_options.SharedMemoryPath, _analyzer.SampleRate);

                _ring = new float[Math.Max(65536, _analyzer.FftSize * 4)];
                _ringPos = 0;
                _totalSamples = 0;
                _windowBuf = new float[_analyzer.FftSize];
                long now = System.Diagnostics.Stopwatch.GetTimestamp();
                _startTicks = now;
                _lastEmitTicks = now;
                _lastDataTicks = now;
                _lastAnalyzeTicks = now;
                _silenceStartTicks = 0;
                _haveQpc = false;
                _lastPacketQpcEnd100ns = 0.0;
                _nextDeviceCheckTicks = now + System.Diagnostics.Stopwatch.Frequency * 2;
                _lastPacketArrivalTicks = 0;
                _capture.Start();
                _running = true;
            }
            catch (Exception ex)
            {
                _startError = ex;
                _startedEvent.Set();
                return;
            }
            _startedEvent.Set();
            try
            {
                CaptureLoop();
            }
            catch (Exception ex)
            {
                Stats.Error = ex.GetType().Name + ": " + ex.Message;
                Action<Exception> handler = CaptureError;
                if (handler != null) { try { handler(ex); } catch { } }
            }
            finally
            {
                _running = false;
            }
        }

        public void Stop()
        {
            lock (_stateLock)
            {
                Thread t = _thread;
                if (t == null && _capture == null)
                {
                    _running = false;
                    return;
                }
                _running = false;
                if (t != null)
                {
                    try { t.Join(3000); } catch { }
                    _thread = null;
                }
                if (_capture != null)
                {
                    try { _capture.Dispose(); } catch { }
                    _capture = null;
                }
                if (_writer != null)
                {
                    try { _writer.Dispose(); } catch { }
                    _writer = null;
                }
                if (_analyzer != null) Stats.SampleRate = _analyzer.SampleRate;
                Stats.ElapsedMs = ElapsedMs(System.Diagnostics.Stopwatch.GetTimestamp(), _startTicks);
                if (_timerPeriodActive)
                {
                    WinmmTimer.End1ms();
                    _timerPeriodActive = false;
                }
            }
        }

        public void Dispose()
        {
            Stop();
        }

        /// <summary>Pull model: the most recent frame (one copy; frame arrays are never mutated after publish).</summary>
        public bool TryGetLatest(out AudioFrame frame)
        {
            frame = _latest;
            return frame != null;
        }

        /// <summary>Pull model: oldest queued beat onset. Call every tick; queue is bounded (256).</summary>
        public bool TryDequeueBeat(out BeatEvent beat)
        {
            return _beats.TryDequeue(out beat);
        }

        /// <summary>Optional late sink attach (host may set it after construction).</summary>
        public void SetSink(ISpectrumSink sink)
        {
            _sink = sink;
        }

        // ------------------------------------------------------------------
        private static double ElapsedMs(long nowTicks, long thenTicks)
        {
            return (nowTicks - thenTicks) * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
        }

        private static double Now100ns()
        {
            // Must use raw QPC: WASAPI reports the packet position as a QPC value in 100 ns units,
            // and Stopwatch is not guaranteed to be QPC-backed on every runtime (measured offset
            // against QPC packets was up to -42 ms when using Stopwatch).
            return HighResClock.Now100ns();
        }

        private void OpenAnalyzerForCurrentFormat()
        {
            CaptureFormat fmt = _capture.Format;
            Stats.DeviceId = _capture.DeviceId;
            Stats.FormatText = fmt.ToString();
            Stats.SampleRate = fmt.SampleRate;
            SpectrumOptions o = new SpectrumOptions();
            o.TargetFps = _options.TargetFps;
            o.EnableSmoothing = _options.EnableSmoothing;
            o.EnableAgc = _options.EnableAgc;
            _analyzer = new SpectrumAnalyzer(fmt.SampleRate, o);
            Stats.FftSize = _analyzer.FftSize;
            Stats.SpectrumBins = _analyzer.BinCount;
        }

        private void CaptureLoop()
        {
            double frameIntervalMs = 1000.0 / Math.Max(1, _options.TargetFps);
            long swFreq = System.Diagnostics.Stopwatch.Frequency;
            long intervalTicks = (long)Math.Round(swFreq * frameIntervalMs / 1000.0);
            if (intervalTicks < 1) intervalTicks = 1;
            long nextDeadlineTicks = _lastEmitTicks + intervalTicks;
            while (_running)
            {
                bool gotData = false;
                try
                {
                    long drainStart = System.Diagnostics.Stopwatch.GetTimestamp();
                    gotData = DrainPackets();
                    Stats.DrainTicks += System.Diagnostics.Stopwatch.GetTimestamp() - drainStart;
                    Stats.LoopIterations++;
                }
                catch (Exception ex)
                {
                    if (!TryRecover(ex)) break;
                    nextDeadlineTicks = System.Diagnostics.Stopwatch.GetTimestamp() + intervalTicks;
                    continue;
                }

                long now = System.Diagnostics.Stopwatch.GetTimestamp();
                if (gotData) _lastDataTicks = now;
                bool dataRecent = ElapsedMs(now, _lastDataTicks) < _options.SilenceTimeoutSec * 1000.0;

                // Absolute-deadline emission: sleep rounding never accumulates, so the average
                // rate stays 1/TargetFps even though WASAPI packets arrive every 10-30 ms.
                if (now >= nextDeadlineTicks)
                {
                    long workStart = now;
                    if (dataRecent) Analyze(now);
                    else if (_options.EmitSilentFrames) EmitSilent(now);
                    Stats.AnalyzeTicks += System.Diagnostics.Stopwatch.GetTimestamp() - workStart;
                    nextDeadlineTicks += intervalTicks;
                    if (nextDeadlineTicks <= now) nextDeadlineTicks = now + intervalTicks; // resync after a stall
                }

                if (_options.FollowDefaultDevice && now >= _nextDeviceCheckTicks)
                {
                    _nextDeviceCheckTicks = now + swFreq * 2;
                    try
                    {
                        string currentId = WasapiLoopbackCapture.GetDefaultRenderDeviceId(_options.DeviceRole);
                        if (currentId != null && _capture != null && currentId != _capture.DeviceId)
                            ReopenCapture("default render device changed");
                    }
                    catch
                    {
                        // device check must never kill the capture loop
                    }
                }

                if (!gotData)
                {
                    double remainingMs = (nextDeadlineTicks - now) * 1000.0 / swFreq;
                    // Sleep in large chunks: WASAPI packets are buffered safely and the next
                    // emission only needs the ring to be current, so waking ~2-3x per frame keeps
                    // CPU low while still hitting the deadline. PollIntervalMs caps the poll
                    // interval when there is a long wait (e.g. no device data at all).
                    int maxSleep = Math.Max(1, _options.PollIntervalMs * 3);
                    int sleepMs = (int)Math.Floor(remainingMs - 1.0);
                    if (sleepMs < 1) sleepMs = 1;
                    if (sleepMs > maxSleep) sleepMs = maxSleep;
                    Thread.Sleep(sleepMs);
                }
            }
        }

        private bool TryRecover(Exception ex)
        {
            Stats.Error = ex.GetType().Name + ": " + ex.Message;
            Action<Exception> handler = CaptureError;
            if (handler != null)
            {
                try { handler(ex); } catch { }
            }
            for (int attempt = 1; attempt <= 3 && _running; attempt++)
            {
                Thread.Sleep(500);
                try
                {
                    ReopenCapture("recover: " + Stats.Error);
                    Stats.Error = null;
                    return true;
                }
                catch (Exception reopenEx)
                {
                    Stats.Error = reopenEx.GetType().Name + ": " + reopenEx.Message;
                }
            }
            _running = false;
            return false;
        }

        private void ReopenCapture(string reason)
        {
            Stats.ReopenCount++;
            WasapiLoopbackCapture old = _capture;
            _capture = null;
            if (old != null)
            {
                try { old.Dispose(); } catch { }
            }
            _capture = WasapiLoopbackCapture.Open(_options.DeviceRole, _options.BufferDurationHns);
            int oldRate = _analyzer != null ? _analyzer.SampleRate : 0;
            if (_analyzer == null || _capture.Format.SampleRate != oldRate)
            {
                OpenAnalyzerForCurrentFormat();
                _windowBuf = new float[_analyzer.FftSize];
            }
            else
            {
                _analyzer.Reset();
            }
            _ring = new float[Math.Max(65536, _analyzer.FftSize * 4)];
            _ringPos = 0;
            _haveQpc = false;
            _silenceStartTicks = 0;
            _capture.Start();
            Stats.DeviceId = _capture.DeviceId;
            Stats.FormatText = _capture.Format.ToString();
            Stats.SampleRate = _capture.Format.SampleRate;
            GC.KeepAlive(reason);
        }

        private bool DrainPackets()
        {
            bool got = false;
            int packetFrames = _capture.GetNextPacketSize();
            int guard = 0;
            while (packetFrames > 0 && guard++ < 64)
            {
                IntPtr data;
                int frames;
                int flags;
                ulong devicePos;
                ulong qpcPos;
                int hr = _capture.GetBuffer(out data, out frames, out flags, out devicePos, out qpcPos);
                WasapiLoopbackCapture.Check(hr, "IAudioCaptureClient.GetBuffer");
                if (frames > 0)
                {
                    got = true;
                    CaptureFormat fmt = _capture.Format;
                    if ((flags & AudioConstants.AUDCLNT_BUFFERFLAGS_SILENT) != 0)
                    {
                        AppendZeros(frames);
                    }
                    else
                    {
                        ConvertToMono(data, frames);
                        AppendSamples(_mono, frames);
                    }
                    if ((flags & AudioConstants.AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) != 0)
                        Stats.Discontinuities++;
                    _lastPacketArrivalTicks = System.Diagnostics.Stopwatch.GetTimestamp();
                    if (qpcPos != 0)
                    {
                        _lastPacketQpcEnd100ns = qpcPos + frames * 10000000.0 / fmt.SampleRate;
                        _haveQpc = true;
                        Stats.QpcPackets++;
                        if (Environment.GetEnvironmentVariable("SPW_DEBUG_QPC") != null && Stats.QpcPackets < 6)
                        {
                            Console.Error.WriteLine(string.Format(CultureInfo.InvariantCulture,
                                "qpc debug: pos={0:F0} frames={1} sr={2} end100ns={3:F0} now100ns={4:F0} deltaMs={5:F2}",
                                (double)qpcPos, frames, fmt.SampleRate, _lastPacketQpcEnd100ns, Now100ns(),
                                (Now100ns() - _lastPacketQpcEnd100ns) / 10000.0));
                        }
                    }
                    Stats.DataPackets++;
                    Stats.TotalMonoSamples += frames;
                    _lastPacketSamplePos = _totalSamples;
                }
                _capture.ReleaseBuffer(frames);
                packetFrames = _capture.GetNextPacketSize();
            }
            if (!got) Stats.EmptyDrains++;
            return got;
        }

        private void ConvertToMono(IntPtr data, int frames)
        {
            CaptureFormat fmt = _capture.Format;
            int ch = fmt.Channels;
            int total = frames * ch;
            if (_mono == null || _mono.Length < frames) _mono = new float[Math.Max(frames, 4096)];

            if (fmt.IsFloat && fmt.BitsPerSample == 32)
            {
                if (_pktFloat == null || _pktFloat.Length < total) _pktFloat = new float[total];
                System.Runtime.InteropServices.Marshal.Copy(data, _pktFloat, 0, total);
                if (ch == 1) { for (int i = 0; i < frames; i++) _mono[i] = _pktFloat[i]; return; }
                float inv = 1f / ch;
                for (int i = 0, p = 0; i < frames; i++)
                {
                    float sum = 0f;
                    for (int c = 0; c < ch; c++) sum += _pktFloat[p++];
                    _mono[i] = sum * inv;
                }
                return;
            }
            if (!fmt.IsFloat && fmt.BitsPerSample == 16)
            {
                if (_pktShort == null || _pktShort.Length < total) _pktShort = new short[total];
                System.Runtime.InteropServices.Marshal.Copy(data, _pktShort, 0, total);
                float inv = 1f / (ch * 32768f);
                for (int i = 0, p = 0; i < frames; i++)
                {
                    int sum = 0;
                    for (int c = 0; c < ch; c++) sum += _pktShort[p++];
                    _mono[i] = sum * inv;
                }
                return;
            }
            if (!fmt.IsFloat && fmt.BitsPerSample == 24)
            {
                int bytes = total * 3;
                if (_pktByte == null || _pktByte.Length < bytes) _pktByte = new byte[bytes];
                System.Runtime.InteropServices.Marshal.Copy(data, _pktByte, 0, bytes);
                float inv = 1f / (ch * 8388608f);
                for (int i = 0, p = 0; i < frames; i++)
                {
                    int sum = 0;
                    for (int c = 0; c < ch; c++)
                    {
                        int v = _pktByte[p] | (_pktByte[p + 1] << 8) | (_pktByte[p + 2] << 16);
                        if ((v & 0x800000) != 0) v |= unchecked((int)0xFF000000);
                        sum += v;
                        p += 3;
                    }
                    _mono[i] = sum * inv;
                }
                return;
            }
            if (!fmt.IsFloat && fmt.BitsPerSample == 32)
            {
                if (_pktInt == null || _pktInt.Length < total) _pktInt = new int[total];
                System.Runtime.InteropServices.Marshal.Copy(data, _pktInt, 0, total);
                double inv = 1.0 / (ch * 2147483648.0);
                for (int i = 0, p = 0; i < frames; i++)
                {
                    long sum = 0;
                    for (int c = 0; c < ch; c++) sum += _pktInt[p++];
                    _mono[i] = (float)(sum * inv);
                }
                return;
            }
            if (!fmt.IsFloat && fmt.BitsPerSample == 8)
            {
                int bytes = total;
                if (_pktByte == null || _pktByte.Length < bytes) _pktByte = new byte[bytes];
                System.Runtime.InteropServices.Marshal.Copy(data, _pktByte, 0, bytes);
                float inv = 1f / ch;
                for (int i = 0, p = 0; i < frames; i++)
                {
                    float sum = 0f;
                    for (int c = 0; c < ch; c++) sum += (_pktByte[p++] - 128) / 128f;
                    _mono[i] = sum * inv;
                }
                return;
            }
            for (int i = 0; i < frames; i++) _mono[i] = 0f;
        }

        private void AppendSamples(float[] samples, int count)
        {
            int ringLen = _ring.Length;
            for (int i = 0; i < count; i++)
            {
                _ring[_ringPos] = samples[i];
                _ringPos++;
                if (_ringPos >= ringLen) _ringPos = 0;
            }
            _totalSamples += count;
        }

        private void AppendZeros(int count)
        {
            int ringLen = _ring.Length;
            for (int i = 0; i < count; i++)
            {
                _ring[_ringPos] = 0f;
                _ringPos++;
                if (_ringPos >= ringLen) _ringPos = 0;
            }
            _totalSamples += count;
        }

        private void FillWindow()
        {
            int win = _analyzer.FftSize;
            int avail = (int)Math.Min(_totalSamples, win);
            int pad = win - avail;
            for (int i = 0; i < pad; i++) _windowBuf[i] = 0f;
            int ringLen = _ring.Length;
            int start = (int)((_ringPos - avail + ringLen) % ringLen);
            for (int i = 0; i < avail; i++) _windowBuf[pad + i] = _ring[(start + i) % ringLen];
        }

        private void Analyze(long nowTicks)
        {
            FillWindow();
            double dtMs = ElapsedMs(nowTicks, _lastAnalyzeTicks);
            if (dtMs < 1.0) dtMs = 1000.0 / _options.TargetFps;
            AudioFrame f = _analyzer.Process(_windowBuf, dtMs / 1000.0);
            f.Seq = ++_seq;
            f.TsEpochMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            f.TsMonoMs = ElapsedMs(nowTicks, _startTicks);
            f.SamplePos = _totalSamples;
            double latencyMs = ComputeLatencyMs(nowTicks);
            f.LatencyMs = (float)latencyMs;
            Stats.AddLatency(latencyMs);
            Stats.FramesEmitted++;
            if (!f.Silent) Stats.FramesAnalyzed++;
            _lastAnalyzeTicks = nowTicks;
            _lastEmitTicks = nowTicks;
            _silenceStartTicks = 0;

            if (f.Beat)
            {
                Stats.BeatCount++;
                if (f.BeatDownbeat) Stats.DownbeatCount++;
                _beats.Enqueue(new BeatEvent
                {
                    Seq = f.Seq,
                    TsEpochMs = f.TsEpochMs,
                    TsMonoMs = f.TsMonoMs,
                    Strength = f.BeatStrength,
                    IsDownbeat = f.BeatDownbeat,
                    IbiMs = _analyzer.IbiMs
                });
                TrimBeatQueue();
            }
            Publish(f);
        }

        private void EmitSilent(long nowTicks)
        {
            if (_silenceStartTicks == 0) _silenceStartTicks = nowTicks;
            if (ElapsedMs(nowTicks, _silenceStartTicks) > 500.0) _analyzer.Reset();
            AudioFrame f = AudioFrame.SilentFrame();
            f.Seq = ++_seq;
            f.TsEpochMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            f.TsMonoMs = ElapsedMs(nowTicks, _startTicks);
            f.SamplePos = _totalSamples;
            f.SampleRate = _analyzer.SampleRate;
            f.LatencyMs = 0f;
            Stats.FramesEmitted++;
            Stats.SilentFrames++;
            _lastEmitTicks = nowTicks;
            Publish(f);
        }

        private void TrimBeatQueue()
        {
            BeatEvent discard;
            while (_beats.Count > BeatQueueLimit && _beats.TryDequeue(out discard)) { }
        }

        private void Publish(AudioFrame f)
        {
            _latest = f;

            if (_writer != null)
            {
                try { _writer.WriteFrame(f); } catch { }
            }

            ISpectrumSink sink = _sink;
            if (sink != null)
            {
                try { sink.OnAudioFrame(f); } catch { }
                if (f.Beat)
                {
                    try
                    {
                        sink.OnBeat(new BeatEvent
                        {
                            Seq = f.Seq,
                            TsEpochMs = f.TsEpochMs,
                            TsMonoMs = f.TsMonoMs,
                            Strength = f.BeatStrength,
                            IsDownbeat = f.BeatDownbeat,
                            IbiMs = _analyzer.IbiMs
                        });
                    }
                    catch { }
                }
            }

            Action<AudioFrame> handler = FrameReady;
            if (handler != null)
            {
                try { handler(f); } catch { }
            }
            if (f.Beat)
            {
                Action<BeatEvent> beatHandler = BeatReady;
                if (beatHandler != null)
                {
                    try
                    {
                        beatHandler(new BeatEvent
                        {
                            Seq = f.Seq,
                            TsEpochMs = f.TsEpochMs,
                            TsMonoMs = f.TsMonoMs,
                            Strength = f.BeatStrength,
                            IsDownbeat = f.BeatDownbeat,
                            IbiMs = _analyzer.IbiMs
                        });
                    }
                    catch { }
                }
            }
        }

        private double ComputeLatencyMs(long nowTicks)
        {
            if (_haveQpc)
            {
                double raw = (Now100ns() - _lastPacketQpcEnd100ns) / 10000.0;
                Stats.AddRawLatency(raw);
                // Windows loopback timestamps packets slightly AHEAD of the local QPC clock
                // (render engine pre-runs); record the lead as a diagnostic, never as latency.
                Stats.AddQpcLead(-raw);
            }
            // Reported latency = capture-to-emit service time: how long the newest audio waited
            // between the capture client delivering it and this frame being published to the sink.
            long lastArrival = _lastPacketArrivalTicks > 0 ? _lastPacketArrivalTicks : nowTicks;
            double lag = ElapsedMs(nowTicks, lastArrival);
            if (lag < 0) lag = 0;
            if (lag > 500) lag = 500;
            return lag;
        }

        /// <summary>One-shot device description (used by --describe / docs evidence).</summary>
        public static string DescribeDefaultDevice(int role)
        {
            using (WasapiLoopbackCapture cap = WasapiLoopbackCapture.Open(role, 10L * AudioConstants.HNS_PER_SECOND))
            {
                return string.Format(CultureInfo.InvariantCulture,
                    "deviceId={0} format={1} bufferFrames={2} streamLatencyMs={3:F2}",
                    cap.DeviceId, cap.Format, cap.BufferFrames, cap.StreamLatencyMs);
            }
        }
    }

    /// <summary>1 ms Windows timer resolution (winmm). Balanced Begin/End; no-op if unavailable.</summary>
    internal static class WinmmTimer    {
        [DllImport("winmm.dll", EntryPoint = "timeBeginPeriod", SetLastError = false)]
        private static extern uint TimeBeginPeriod(uint milliseconds);

        [DllImport("winmm.dll", EntryPoint = "timeEndPeriod", SetLastError = false)]
        private static extern uint TimeEndPeriod(uint milliseconds);

        private static int _balance;

        public static void Begin1ms()
        {
            try
            {
                Interlocked.Increment(ref _balance);
                TimeBeginPeriod(1);
            }
            catch
            {
                // winmm is always present on Windows; ignore any exotic failure.
            }
        }

        public static void End1ms()
        {
            try
            {
                if (Interlocked.Decrement(ref _balance) < 0)
                {
                    Interlocked.Exchange(ref _balance, 0);
                    return;
                }
                TimeEndPeriod(1);
            }
            catch
            {
            }
        }
    }

    /// <summary>QueryPerformanceCounter in 100 ns units (same clock family as WASAPI packet QPC).</summary>
    internal static class HighResClock
    {
        [DllImport("kernel32.dll", EntryPoint = "QueryPerformanceCounter", SetLastError = false)]
        private static extern bool QueryPerformanceCounterNative(out long value);

        [DllImport("kernel32.dll", EntryPoint = "QueryPerformanceFrequency", SetLastError = false)]
        private static extern bool QueryPerformanceFrequencyNative(out long value);

        private static readonly double To100ns = InitScale();

        private static double InitScale()
        {
            long freq;
            if (QueryPerformanceFrequencyNative(out freq) && freq > 0)
                return 10000000.0 / freq;
            return 1.0;
        }

        public static double Now100ns()
        {
            long counter;
            QueryPerformanceCounterNative(out counter);
            return counter * To100ns;
        }
    }
}
