// Audio seam for spw-folia-host: the 60 Hz tick asks a provider for the current Folia audio
// payload. Values are already on the protocol scale (docs/protocol.md §5): power/5 bands are
// 0..255 gamma-shaped bytes, spectrum is 1024 raw 0..255 bins (empty = silence).
//
// Providers
//   LoopbackAudioProvider (compiled in with -define:LOOPBACK, wraps audio-probe's
//     SpwFolia.Audio.LoopbackAnalyzer)  -> real WASAPI loopback analysis
//   StdinAudioProvider                 -> debug: audio frames pushed from stdin {"type":"audio"}
//   SyntheticAudioProvider             -> breathing fallback when loopback is unavailable/off
//
// C# 5 only (in-box .NET Framework 4.8 csc.exe).
using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace SpwFolia
{
    public sealed class AudioFrame
    {
        public bool Silent;
        public float Power;      // 0..255 gamma-shaped (Folia audioPower)
        public float Bass;       // 0..255
        public float LowMid;     // 0..255
        public float Mid;        // 0..255
        public float Vocal;      // 0..255
        public float Treble;     // 0..255
        public byte[] Spectrum;  // 1024 raw bins, 0..255; Length==0 when silent

        public AudioFrame()
        {
            Spectrum = Empty;
        }

        private static readonly byte[] Empty = new byte[0];
    }

    public interface IAudioProvider : IDisposable
    {
        // Frame for the current tick. Never null.
        AudioFrame GetFrame(long elapsedMs);
        string Name { get; }
    }

    // Breathing fallback per docs/protocol.md §5: paused/no-signal -> power+bands follow
    // breath=(sin(now/2000)+1)*20, spectrum empty. While "playing" without loopback we synthesize a
    // gentle bounded animation so visual effects stay alive; both are clearly marked Silent=false?/
    // No: synthetic frames report Silent=true so the plugin can show "no audio device" diagnostics.
    public sealed class SyntheticAudioProvider : IAudioProvider
    {
        private readonly Stopwatch clock = new Stopwatch();
        private readonly byte[] spectrum = new byte[1024];
        private int phase;

        public SyntheticAudioProvider()
        {
            clock.Start();
        }

        public string Name { get { return "synthetic-breath"; } }

        public AudioFrame GetFrame(long elapsedMs)
        {
            double now = elapsedMs;
            double breath = (Math.Sin(now / 2000.0) + 1) * 20;
            double pulse = 0.5 + 0.5 * Math.Sin(now / 1600.0 * Math.PI * 2);
            AudioFrame f = new AudioFrame();
            f.Silent = true;
            f.Power = (float)(breath + pulse * 6);
            f.Bass = (float)(breath * 0.9 + pulse * 5);
            f.LowMid = (float)(breath * 0.8);
            f.Mid = (float)(breath * 0.7);
            f.Vocal = (float)(breath * 0.6);
            f.Treble = (float)(breath * 0.5);
            f.Spectrum = new byte[0];
            return f;
        }

        public void Dispose() { }
    }

    // Debug path: stdin state/audio messages can push a full frame (used by the driver / dev harness
    // and by stdin-forwarding integrations). Thread-safe single-slot.
    public sealed class StdinAudioProvider : IAudioProvider
    {
        private readonly object gate = new object();
        private AudioFrame latest;
        private long latestAtMs;

        public string Name { get { return "stdin"; } }

        // true while a frame pushed from stdin is recent enough to drive the renderer (debug path:
        // the plugin/Kotlin side or a test driver may forward its own analysis).
        public bool HasFresh(long elapsedMs)
        {
            lock (gate)
            {
                return latest != null && elapsedMs - latestAtMs <= 1000;
            }
        }

        public void Submit(AudioFrame frame, long elapsedMs)
        {
            lock (gate)
            {
                latest = frame;
                latestAtMs = elapsedMs;
            }
        }

        public AudioFrame GetFrame(long elapsedMs)
        {
            lock (gate)
            {
                if (latest == null || elapsedMs - latestAtMs > 1000)
                {
                    return SilentBreath(elapsedMs);
                }
                return latest;
            }
        }

        public static AudioFrame SilentBreath(long elapsedMs)
        {
            double breath = (Math.Sin(elapsedMs / 2000.0) + 1) * 20;
            AudioFrame f = new AudioFrame();
            f.Silent = true;
            f.Power = (float)breath;
            f.Bass = f.LowMid = f.Mid = f.Vocal = f.Treble = (float)breath;
            f.Spectrum = new byte[0];
            return f;
        }

        public void Dispose() { }
    }

#if LOOPBACK
    // Real WASAPI loopback audio analysis (audio-probe's LoopbackAnalyzer, compiled into this exe).
    // Pull model: the analyzer fills frames on a capture thread; the 60 Hz tick lifts the latest.
    public sealed class LoopbackAudioProvider : IAudioProvider
    {
        private readonly SpwFolia.Audio.LoopbackAnalyzer analyzer;
        private readonly Stopwatch clock = new Stopwatch();
        private string error;

        public LoopbackAudioProvider()
        {
            clock.Start();
            try
            {
                SpwFolia.Audio.LoopbackOptions options = new SpwFolia.Audio.LoopbackOptions();
                analyzer = new SpwFolia.Audio.LoopbackAnalyzer(options, null);
                analyzer.Start();
            }
            catch (Exception ex)
            {
                error = ex.GetType().Name + ": " + ex.Message;
                analyzer = null;
            }
        }

        public string Name { get { return analyzer != null ? "wasapi-loopback" : "wasapi-loopback-failed"; } }
        public string Error { get { return error; } }

        public AudioFrame GetFrame(long elapsedMs)
        {
            SpwFolia.Audio.AudioFrame source;
            if (analyzer == null || !analyzer.TryGetLatest(out source) || source == null)
            {
                return StdinAudioProvider.SilentBreath(elapsedMs);
            }
            AudioFrame f = new AudioFrame();
            f.Silent = source.Silent;
            f.Power = source.Power;
            f.Bass = source.Bass;
            f.LowMid = source.LowMid;
            f.Mid = source.Mid;
            f.Vocal = source.Vocal;
            f.Treble = source.Treble;
            f.Spectrum = source.Spectrum ?? new byte[0];
            return f;
        }

        public void Dispose()
        {
            try { if (analyzer != null) analyzer.Stop(); } catch (Exception) { }
            try { if (analyzer != null) analyzer.Dispose(); } catch (Exception) { }
        }
    }
#endif

    // Chooses the active provider; protocol `audioMode` can switch at runtime.
    public sealed class AudioRouter : IDisposable
    {
        private readonly SyntheticAudioProvider synthetic = new SyntheticAudioProvider();
        private readonly StdinAudioProvider stdin = new StdinAudioProvider();
        private IAudioProvider active;
        private string mode = "loopback";

        public AudioRouter()
        {
            active = synthetic;
#if LOOPBACK
            try
            {
                LoopbackAudioProvider loopback = new LoopbackAudioProvider();
                if (loopback.Name == "wasapi-loopback") active = loopback;
                else loopback.Dispose();
            }
            catch (Exception) { }
#endif
        }

        public string Name { get { return active.Name; } }
        public StdinAudioProvider Stdin { get { return stdin; } }

        public void SetMode(string next)
        {
            if (string.IsNullOrEmpty(next)) return;
            mode = next;
            if (next == "off") active = synthetic;
            else if (next == "stdin") active = stdin;
            else
            {
#if LOOPBACK
                try { active = new LoopbackAudioProvider(); }
                catch (Exception) { active = synthetic; }
#else
                active = synthetic;
#endif
            }
        }

        public AudioFrame GetFrame(long elapsedMs)
        {
            // Debug/override: a fresh frame pushed over stdin wins over the configured provider.
            if (stdin.HasFresh(elapsedMs)) return stdin.GetFrame(elapsedMs);
            return active.GetFrame(elapsedMs);
        }

        public void Dispose()
        {
            try { if (active != null) active.Dispose(); } catch (Exception) { }
        }
    }
}
