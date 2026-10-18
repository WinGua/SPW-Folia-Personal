// SPDX-License-Identifier: MIT
// spw-folia-spectrum.exe -- standalone measurement harness for SpwFolia.Audio.LoopbackAnalyzer.
//
// The real product embeds LoopbackAnalyzer inside spw-folia-host.exe (webview-spike, task-6) and
// pushes frames to the WebView page. This harness exists to measure the analyzer against known
// audio signals: one JSON line per AudioFrame on stdout (~60/s), optional CSV, beat event lines,
// and a stats line on stderr (fps, capture->emit latency, CPU, device/format).
//
//   spw-folia-spectrum.exe [--seconds 10] [--frames N] [--fps 60] [--json|--csv] [--quiet]
//                          [--shm PATH] [--read-shm PATH] [--role console|multimedia]
//                          [--no-agc] [--no-smoothing] [--no-silent] [--stats-json]
//                          [--selftest] [--describe] [--help]
//
// Exit codes: 0 ok, 1 error, 2 selftest failures.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;

namespace SpwFolia.Audio.Probe
{
    internal sealed class HarnessOptions
    {
        public double Seconds = 10.0;
        public int MaxFrames = 0;
        public int Fps = 60;
        public int Role = AudioConstants.eConsole;
        public bool Csv;
        public bool Quiet;
        public bool SkipSerialize;
        public bool StatsJson;
        public bool NoSilent;
        public bool NoAgc;
        public bool NoSmoothing;
        public bool SelfTest;
        public bool Describe;
        public string ShmPath;
        public string ReadShmPath;
    }

    internal static class Program
    {
        private static volatile bool _stop;
        private static long _frames;
        private static long _beats;
        private static long _downbeats;
        private static long _silent;
        private static long _errors;
        private static long _emitTotalUs;
        private static long _emitMaxUs;
        private static readonly List<double> Latencies = new List<double>();
        private static readonly object LatencyLock = new object();

        [MTAThread]
        private static int Main(string[] args)
        {
            try
            {
                HarnessOptions h = ParseArgs(args);
                if (h == null) { PrintHelp(); return 1; }
                if (h.SelfTest) return RunSelfTest();
                if (h.Describe) { Console.WriteLine(LoopbackAnalyzer.DescribeDefaultDevice(h.Role)); return 0; }
                if (h.ReadShmPath != null) return RunReadShm(h);
                return RunCapture(h);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("error: " + ex.GetType().Name + ": " + ex.Message);
                return 1;
            }
        }

        private static HarnessOptions ParseArgs(string[] args)
        {
            HarnessOptions h = new HarnessOptions();
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                switch (a)
                {
                    case "--seconds": h.Seconds = double.Parse(Next(args, ref i), CultureInfo.InvariantCulture); break;
                    case "--frames": h.MaxFrames = int.Parse(Next(args, ref i), CultureInfo.InvariantCulture); break;
                    case "--fps": h.Fps = int.Parse(Next(args, ref i), CultureInfo.InvariantCulture); break;
                    case "--json": h.Csv = false; break;
                    case "--csv": h.Csv = true; break;
                    case "--quiet": h.Quiet = true; break;
                    case "--perf": h.SkipSerialize = true; break;
                    case "--stats-json": h.StatsJson = true; break;
                    case "--no-silent": h.NoSilent = true; break;
                    case "--no-agc": h.NoAgc = true; break;
                    case "--no-smoothing": h.NoSmoothing = true; break;
                    case "--shm": h.ShmPath = Next(args, ref i); break;
                    case "--read-shm": h.ReadShmPath = Next(args, ref i); break;
                    case "--role":
                        {
                            string role = Next(args, ref i);
                            if (role == "console") h.Role = AudioConstants.eConsole;
                            else if (role == "multimedia") h.Role = AudioConstants.eMultimedia;
                            else throw new ArgumentException("--role must be console|multimedia");
                            break;
                        }
                    case "--selftest": h.SelfTest = true; break;
                    case "--describe": h.Describe = true; break;
                    case "--help":
                    case "-h": return null;
                    default: throw new ArgumentException("unknown argument: " + a);
                }
            }
            if (h.Seconds <= 0 && h.MaxFrames <= 0) throw new ArgumentException("--seconds must be > 0");
            if (h.Fps < 1 || h.Fps > 240) throw new ArgumentException("--fps out of range 1..240");
            return h;
        }

        private static string Next(string[] args, ref int i)
        {
            i++;
            if (i >= args.Length) throw new ArgumentException("missing value after " + args[i - 1]);
            return args[i];
        }

        private static void PrintHelp()
        {
            Console.Error.WriteLine("spw-folia-spectrum: standalone WASAPI loopback -> Folia audio contract probe");
            Console.Error.WriteLine("usage: spw-folia-spectrum [--seconds N] [--frames N] [--fps 60] [--json|--csv] [--quiet]");
            Console.Error.WriteLine("                          [--shm PATH] [--read-shm PATH] [--role console|multimedia]");
            Console.Error.WriteLine("                          [--no-agc] [--no-smoothing] [--no-silent] [--stats-json]");
            Console.Error.WriteLine("                          [--selftest] [--describe] [--help]");
            Console.Error.WriteLine();
            Console.Error.WriteLine("JSON frame keys: ev seq ts mono sp sr power bass lowMid mid vocal treble");
            Console.Error.WriteLine("                 rawBass rawLowMid rawMid rawVocal rawTreble rms agc beat downbeat bst lat silent spec[1024]");
        }

        // ------------------------------------------------------------------
        private static int RunCapture(HarnessOptions h)
        {
            LoopbackOptions o = new LoopbackOptions();
            o.TargetFps = h.Fps;
            o.DeviceRole = h.Role;
            o.EmitSilentFrames = !h.NoSilent;
            o.EnableAgc = h.NoAgc;
            o.EnableSmoothing = !h.NoSmoothing;
            o.SharedMemoryPath = h.ShmPath;

            StringBuilder sb = new StringBuilder(8192);
            LoopbackAnalyzer a = new LoopbackAnalyzer(o);
            a.CaptureError += delegate(Exception ex) { _errors++; Console.Error.WriteLine("capture error: " + ex.Message); };
            a.FrameReady += delegate(AudioFrame f)
            {
                long start = Stopwatch.GetTimestamp();
                _frames++;
                if (f.Beat) _beats++;
                if (f.BeatDownbeat) _downbeats++;
                if (f.Silent) _silent++;
                lock (LatencyLock) Latencies.Add(f.LatencyMs);
                if (!h.SkipSerialize) Emit(f, h, sb);
                long us = (Stopwatch.GetTimestamp() - start) * 1000000L / Stopwatch.Frequency;
                _emitTotalUs += us;
                if (us > _emitMaxUs) _emitMaxUs = us;
                if (h.MaxFrames > 0 && _frames >= h.MaxFrames) _stop = true;
            };

            if (!h.Quiet)
                Console.Error.WriteLine("probe: starting system loopback, fps=" + h.Fps
                    + " seconds=" + h.Seconds.ToString("F1", CultureInfo.InvariantCulture)
                    + (h.ShmPath != null ? " shm=" + h.ShmPath : ""));

            Process proc = Process.GetCurrentProcess();
            proc.Refresh();
            TimeSpan cpu0 = proc.TotalProcessorTime;
            Stopwatch wall = Stopwatch.StartNew();
            a.Start();
            while (!_stop && wall.Elapsed.TotalSeconds < h.Seconds) Thread.Sleep(20);
            a.Stop();
            wall.Stop();
            proc.Refresh();
            TimeSpan cpu1 = proc.TotalProcessorTime;

            PrintStats(h, a, wall.Elapsed.TotalSeconds, (cpu1 - cpu0).TotalMilliseconds);
            return _errors > 0 && _frames == 0 ? 1 : 0;
        }

        private static void Emit(AudioFrame f, HarnessOptions h, StringBuilder sb)
        {
            if (h.Csv)
            {
                sb.Length = 0;
                sb.Append(f.Seq).Append(',')
                  .Append(f.TsEpochMs).Append(',')
                  .Append(f.Power.ToString("F2", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.Bass.ToString("F2", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.LowMid.ToString("F2", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.Mid.ToString("F2", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.Vocal.ToString("F2", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.Treble.ToString("F2", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.RawBass.ToString("F2", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.Rms.ToString("F4", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.Beat ? 1 : 0).Append(',')
                  .Append(f.LatencyMs.ToString("F2", CultureInfo.InvariantCulture)).Append(',')
                  .Append(f.Silent ? 1 : 0);
                if (!h.Quiet) Console.Out.WriteLine(sb.ToString());
                return;
            }

            sb.Length = 0;
            sb.Append("{\"ev\":\"frame\",\"seq\":").Append(f.Seq)
              .Append(",\"ts\":").Append(f.TsEpochMs)
              .Append(",\"mono\":").Append(f.TsMonoMs.ToString("F3", CultureInfo.InvariantCulture))
              .Append(",\"sp\":").Append(f.SamplePos)
              .Append(",\"sr\":").Append(f.SampleRate)
              .Append(",\"power\":").Append(f.Power.ToString("F3", CultureInfo.InvariantCulture))
              .Append(",\"bass\":").Append(f.Bass.ToString("F3", CultureInfo.InvariantCulture))
              .Append(",\"lowMid\":").Append(f.LowMid.ToString("F3", CultureInfo.InvariantCulture))
              .Append(",\"mid\":").Append(f.Mid.ToString("F3", CultureInfo.InvariantCulture))
              .Append(",\"vocal\":").Append(f.Vocal.ToString("F3", CultureInfo.InvariantCulture))
              .Append(",\"treble\":").Append(f.Treble.ToString("F3", CultureInfo.InvariantCulture));
            sb.Append(",\"rawBass\":").Append(f.RawBass.ToString("F2", CultureInfo.InvariantCulture))
              .Append(",\"rawLowMid\":").Append(f.RawLowMid.ToString("F2", CultureInfo.InvariantCulture))
              .Append(",\"rawMid\":").Append(f.RawMid.ToString("F2", CultureInfo.InvariantCulture))
              .Append(",\"rawVocal\":").Append(f.RawVocal.ToString("F2", CultureInfo.InvariantCulture))
              .Append(",\"rawTreble\":").Append(f.RawTreble.ToString("F2", CultureInfo.InvariantCulture))
              .Append(",\"rms\":").Append(f.Rms.ToString("F4", CultureInfo.InvariantCulture))
              .Append(",\"agc\":").Append(f.AgcGain.ToString("F3", CultureInfo.InvariantCulture))
              .Append(",\"beat\":").Append(f.Beat ? 1 : 0)
              .Append(",\"downbeat\":").Append(f.BeatDownbeat ? 1 : 0)
              .Append(",\"bst\":").Append(f.BeatStrength.ToString("F3", CultureInfo.InvariantCulture))
              .Append(",\"lat\":").Append(f.LatencyMs.ToString("F2", CultureInfo.InvariantCulture))
              .Append(",\"silent\":").Append(f.Silent ? 1 : 0)
              .Append(",\"spec\":[");
            if (f.Spectrum != null)
            {
                for (int i = 0; i < f.Spectrum.Length; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append(f.Spectrum[i]);
                }
            }
            sb.Append("]}");
            if (!h.Quiet) Console.Out.WriteLine(sb.ToString());

            if (f.Beat)
            {
                sb.Length = 0;
                sb.Append("{\"ev\":\"beat\",\"seq\":").Append(f.Seq)
                  .Append(",\"ts\":").Append(f.TsEpochMs)
                  .Append(",\"mono\":").Append(f.TsMonoMs.ToString("F3", CultureInfo.InvariantCulture))
                  .Append(",\"strength\":").Append(f.BeatStrength.ToString("F3", CultureInfo.InvariantCulture))
                  .Append(",\"downbeat\":").Append(f.BeatDownbeat ? 1 : 0)
                  .Append("}");
                if (!h.Quiet) Console.Out.WriteLine(sb.ToString());
            }
        }

        private static void PrintStats(HarnessOptions h, LoopbackAnalyzer a, double wallSec, double cpuMs)
        {
            LoopbackStatistics s = a.Stats;
            double fps = wallSec > 0 ? _frames / wallSec : 0.0;
            double cpuPercentOneCore = wallSec > 0 ? cpuMs / (wallSec * 1000.0) * 100.0 : 0.0;
            double cpuPercentTotal = cpuPercentOneCore / Environment.ProcessorCount;
            double latMean, latP95, latMax;
            lock (LatencyLock)
            {
                latMean = s.MeanLatencyMs;
                latMax = s.MaxLatencyMs;
                latP95 = 0.0;
                if (Latencies.Count > 0)
                {
                    double[] copy = Latencies.ToArray();
                    Array.Sort(copy);
                    latP95 = copy[Math.Min(copy.Length - 1, (int)(copy.Length * 0.95))];
                }
            }
            double emitAvgUs = _frames > 0 ? (double)_emitTotalUs / _frames : 0.0;
            // Work accounting independent of the noisy process CPU counter (15.6 ms tick granularity).
            double analyzeAvgUs = _frames > 0 ? (double)s.AnalyzeTicks * 1000000.0 / Stopwatch.Frequency / _frames : 0.0;
            double drainAvgUs = _frames > 0 ? (double)s.DrainTicks * 1000000.0 / Stopwatch.Frequency / _frames : 0.0;
            double loopPerSec = wallSec > 0 ? s.LoopIterations / wallSec : 0.0;

            if (h.StatsJson)
            {
                StringBuilder sb = new StringBuilder(512);
                sb.Append("{\"ev\":\"stats\",\"frames\":").Append(_frames)
                  .Append(",\"beats\":").Append(_beats)
                  .Append(",\"downbeats\":").Append(_downbeats)
                  .Append(",\"silent\":").Append(_silent)
                  .Append(",\"analyzed\":").Append(s.FramesAnalyzed)
                  .Append(",\"seconds\":").Append(wallSec.ToString("F3", CultureInfo.InvariantCulture))
                  .Append(",\"fps\":").Append(fps.ToString("F2", CultureInfo.InvariantCulture))
                  .Append(",\"cpuMs\":").Append(cpuMs.ToString("F1", CultureInfo.InvariantCulture))
                  .Append(",\"cpuPercentOneCore\":").Append(cpuPercentOneCore.ToString("F3", CultureInfo.InvariantCulture))
                  .Append(",\"cpuPercentTotal\":").Append(cpuPercentTotal.ToString("F4", CultureInfo.InvariantCulture))
                  .Append(",\"latMeanMs\":").Append(latMean.ToString("F2", CultureInfo.InvariantCulture))
                  .Append(",\"latP95Ms\":").Append(latP95.ToString("F2", CultureInfo.InvariantCulture))
                  .Append(",\"latMaxMs\":").Append(latMax.ToString("F2", CultureInfo.InvariantCulture))
                  .Append(",\"emitAvgUs\":").Append(emitAvgUs.ToString("F1", CultureInfo.InvariantCulture))
                  .Append(",\"emitMaxUs\":").Append(_emitMaxUs)
                  .Append(",\"analyzeAvgUs\":").Append(analyzeAvgUs.ToString("F1", CultureInfo.InvariantCulture))
                  .Append(",\"drainAvgUs\":").Append(drainAvgUs.ToString("F2", CultureInfo.InvariantCulture))
                  .Append(",\"loopPerSec\":").Append(loopPerSec.ToString("F1", CultureInfo.InvariantCulture))
                  .Append(",\"dataPackets\":").Append(s.DataPackets)
                  .Append(",\"qpcPackets\":").Append(s.QpcPackets)
                  .Append(",\"rawLatMinMs\":").Append(s.RawLatencySamples > 0 ? s.RawLatencyMinMs.ToString("F2", CultureInfo.InvariantCulture) : "null")
                  .Append(",\"rawLatMaxMs\":").Append(s.RawLatencySamples > 0 ? s.RawLatencyMaxMs.ToString("F2", CultureInfo.InvariantCulture) : "null")
                  .Append(",\"qpcLeadMeanMs\":").Append(s.QpcLeadSamples > 0 ? (s.QpcLeadSumMs / s.QpcLeadSamples).ToString("F2", CultureInfo.InvariantCulture) : "null")
                  .Append(",\"qpcLeadMinMs\":").Append(s.QpcLeadSamples > 0 ? s.QpcLeadMinMs.ToString("F2", CultureInfo.InvariantCulture) : "null")
                  .Append(",\"qpcLeadMaxMs\":").Append(s.QpcLeadSamples > 0 ? s.QpcLeadMaxMs.ToString("F2", CultureInfo.InvariantCulture) : "null")
                  .Append(",\"discontinuities\":").Append(s.Discontinuities)
                  .Append(",\"deviceId\":\"").Append(Escape(s.DeviceId)).Append('"')
                  .Append(",\"format\":\"").Append(Escape(s.FormatText)).Append('"')
                  .Append(",\"sr\":").Append(s.SampleRate)
                  .Append(",\"fft\":").Append(s.FftSize)
                  .Append(",\"bins\":").Append(s.SpectrumBins)
                  .Append(",\"errors\":").Append(_errors)
                  .Append(",\"reopens\":").Append(s.ReopenCount)
                  .Append('}');
                Console.Error.WriteLine(sb.ToString());
            }
            else
            {
                Console.Error.WriteLine(string.Format(CultureInfo.InvariantCulture,
                    "stats: frames={0} fps={1:F2} beats={2} downbeats={3} silent={4} -> cpu={5:F1}ms ({6:F3}% of one core) lat mean/p95/max={7:F2}/{8:F2}/{9:F2}ms emitAvg={10:F1}us device={11} format={12} sr={13} fft={14} bins={15}",
                    _frames, fps, _beats, _downbeats, _silent, cpuMs, cpuPercentOneCore,
                    latMean, latP95, latMax, emitAvgUs, s.DeviceId, s.FormatText, s.SampleRate, s.FftSize, s.SpectrumBins));
            }
        }

        private static string Escape(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        // ------------------------------------------------------------------
        private static int RunReadShm(HarnessOptions h)
        {
            using (SharedAudioRingReader reader = new SharedAudioRingReader(h.ReadShmPath))
            {
                if (!h.Quiet)
                    Console.Error.WriteLine("probe: reading shm " + h.ReadShmPath + " sr=" + reader.SampleRate);
                Stopwatch wall = Stopwatch.StartNew();
                int got = 0;
                StringBuilder sb = new StringBuilder(512);
                while (wall.Elapsed.TotalSeconds < h.Seconds && (h.MaxFrames <= 0 || got < h.MaxFrames))
                {
                    List<AudioFrame> frames = reader.ReadNewFrames();
                    foreach (AudioFrame f in frames)
                    {
                        got++;
                        if (h.Quiet) continue;
                        sb.Length = 0;
                        sb.Append("{\"ev\":\"frame\",\"seq\":").Append(f.Seq)
                          .Append(",\"ts\":").Append(f.TsEpochMs)
                          .Append(",\"power\":").Append(f.Power.ToString("F3", CultureInfo.InvariantCulture))
                          .Append(",\"bass\":").Append(f.Bass.ToString("F3", CultureInfo.InvariantCulture))
                          .Append(",\"silent\":").Append(f.Silent ? 1 : 0)
                          .Append(",\"beat\":").Append(f.Beat ? 1 : 0)
                          .Append(",\"specLen\":").Append(f.Spectrum != null ? f.Spectrum.Length : 0)
                          .Append('}');
                        Console.Out.WriteLine(sb.ToString());
                    }
                    Thread.Sleep(5);
                }
                Console.Error.WriteLine("read-shm: frames=" + got + " seconds=" + wall.Elapsed.TotalSeconds.ToString("F2", CultureInfo.InvariantCulture));
                return got > 0 ? 0 : 1;
            }
        }

        // ------------------------------------------------------------------
        private static int RunSelfTest()
        {
            int failures = 0;
            failures += SpectrumAnalyzer.RunSelfTest(Console.Error, 44100);
            failures += SpectrumAnalyzer.RunSelfTest(Console.Error, 48000);
            // NOTE: use the exe directory, not %TEMP%: some sandboxed environments (including the
            // development sandbox this was built in) deny .NET child processes write access to
            // C:\Users\<user>\AppData\Local\*, while MSYS/bash writes there fine. Override with
            // SPW_FOLIA_SHM_TEST if a different writable location is needed.
            string shmPath = Environment.GetEnvironmentVariable("SPW_FOLIA_SHM_TEST");
            if (string.IsNullOrEmpty(shmPath))
                shmPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "spw-folia-audio-selftest.shm");
            if (!SharedAudioRingReader.SelfTest(Console.Error, shmPath)) failures++;
            Console.Error.WriteLine("selftest: total failures=" + failures);
            return failures == 0 ? 0 : 2;
        }
    }
}
