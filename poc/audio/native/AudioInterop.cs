// SPDX-License-Identifier: MIT
// spw-folia native audio: minimal hand-written WASAPI COM interop (no external deps).
// Clean-room implementation; behavior reference: docs/audio-timeline.md ("island" GPL plugin was
// used only as a behavioral reference, no code copied).
//
// Only the pieces needed for *system* loopback capture of the default render endpoint:
//   IMMDeviceEnumerator -> IMMDevice -> IAudioClient(shared, LOOPBACK) -> IAudioCaptureClient.
// No event handle: the analyzer polls GetNextPacketSize() at ~3-4 ms.
using System;
using System.Runtime.InteropServices;

namespace SpwFolia.Audio
{
    internal static class AudioGuids
    {
        public static readonly Guid IID_IMMDeviceEnumerator = new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6");
        public static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
        public static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317");
        public static readonly Guid IID_IAudioClock = new Guid("CD63314F-3FBA-4A1B-812C-EF96358728E7");
        public static readonly Guid KSDATAFORMAT_SUBTYPE_PCM = new Guid("00000001-0000-0010-8000-00AA00389B71");
        public static readonly Guid KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Guid("00000003-0000-0010-8000-00AA00389B71");
    }

    internal static class AudioConstants
    {
        // EDataFlow / ERole
        public const int eRender = 0;
        public const int eConsole = 0;     // "default device" (system-wide default)
        public const int eMultimedia = 1;

        // AUDCLNT_SHAREMODE
        public const int AUDCLNT_SHAREMODE_SHARED = 0;

        // AUDCLNT_STREAMFLAGS
        public const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        public const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;

        // AUDCLNT_BUFFERFLAGS
        public const int AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
        public const int AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY = 0x1;
        public const int AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR = 0x4;

        // WAVE format tags
        public const int WAVE_FORMAT_PCM = 0x0001;
        public const int WAVE_FORMAT_IEEE_FLOAT = 0x0003;
        public const int WAVE_FORMAT_EXTENSIBLE = 0xFFFE;

        // CLSCTX
        public const int CLSCTX_ALL = 0x17;

        public const long HNS_PER_SECOND = 10000000L; // 100 ns units
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    internal struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    internal struct WAVEFORMATEXTENSIBLE
    {
        public WAVEFORMATEX Format;
        public ushort wValidBitsPerSample;
        public uint dwChannelMask;
        public Guid SubFormat;
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject
    {
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        [PreserveSig]
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);

        [PreserveSig]
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);

        [PreserveSig]
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);

        [PreserveSig]
        int RegisterEndpointNotificationCallback(IntPtr client);

        [PreserveSig]
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        [PreserveSig]
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr ppInterface);

        [PreserveSig]
        int OpenPropertyStore(int access, out IntPtr properties);

        [PreserveSig]
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);

        [PreserveSig]
        int GetState(out int state);
    }

    [ComImport]
    [Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioClient
    {
        [PreserveSig]
        int Initialize(int shareMode, int streamFlags, long hnsBufferDuration, long hnsPeriodicity,
                       IntPtr format, IntPtr audioSessionGuid);

        [PreserveSig]
        int GetBufferSize(out uint bufferFrameCount);

        [PreserveSig]
        int GetStreamLatency(out long latency);

        [PreserveSig]
        int GetCurrentPadding(out uint padding);

        [PreserveSig]
        int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);

        [PreserveSig]
        int GetMixFormat(out IntPtr deviceFormat);

        [PreserveSig]
        int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);

        [PreserveSig]
        int Start();

        [PreserveSig]
        int Stop();

        [PreserveSig]
        int Reset();

        [PreserveSig]
        int SetEventHandle(IntPtr eventHandle);

        [PreserveSig]
        int GetService(ref Guid iid, out IntPtr service);
    }

    [ComImport]
    [Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioCaptureClient
    {
        [PreserveSig]
        int GetBuffer(out IntPtr data, out uint framesToRead, out int flags,
                      out ulong devicePosition, out ulong qpcPosition);

        [PreserveSig]
        int ReleaseBuffer(uint framesRead);

        [PreserveSig]
        int GetNextPacketSize(out uint packetFrames);
    }

    [ComImport]
    [Guid("CD63314F-3FBA-4A1B-812C-EF96358728E7")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioClock
    {
        [PreserveSig]
        int GetFrequency(out ulong frequency);

        [PreserveSig]
        int GetPosition(out ulong devicePosition, out ulong qpcPosition);
    }

    /// <summary>Parsed capture (mix) format of the render endpoint.</summary>
    internal sealed class CaptureFormat
    {
        public int SampleRate;
        public int Channels;
        public int BitsPerSample;
        public int ValidBits;
        public int BlockAlign;
        public bool IsFloat;
        public string FormatName;
        public IntPtr RawFormatPtr;

        public override string ToString()
        {
            return string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "{0} Hz, {1} ch, {2} bit {3}", SampleRate, Channels, BitsPerSample, IsFloat ? "float" : "pcm");
        }

        public static CaptureFormat FromMixFormat(IntPtr ptr)
        {
            if (ptr == IntPtr.Zero) throw new InvalidOperationException("GetMixFormat returned null");
            WAVEFORMATEX wfx = (WAVEFORMATEX)Marshal.PtrToStructure(ptr, typeof(WAVEFORMATEX));
            CaptureFormat f = new CaptureFormat();
            f.RawFormatPtr = ptr;
            f.SampleRate = (int)wfx.nSamplesPerSec;
            f.Channels = wfx.nChannels;
            f.BitsPerSample = wfx.wBitsPerSample;
            f.ValidBits = wfx.wBitsPerSample;
            f.BlockAlign = wfx.nBlockAlign;
            f.IsFloat = false;
            f.FormatName = "pcm";
            int tag = wfx.wFormatTag;
            if (tag == AudioConstants.WAVE_FORMAT_EXTENSIBLE && wfx.cbSize >= 22)
            {
                WAVEFORMATEXTENSIBLE ext =
                    (WAVEFORMATEXTENSIBLE)Marshal.PtrToStructure(ptr, typeof(WAVEFORMATEXTENSIBLE));
                f.ValidBits = ext.wValidBitsPerSample;
                if (ext.SubFormat == AudioGuids.KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)
                {
                    f.IsFloat = true;
                    f.FormatName = "extensible/float";
                }
                else if (ext.SubFormat == AudioGuids.KSDATAFORMAT_SUBTYPE_PCM)
                {
                    f.IsFloat = false;
                    f.FormatName = "extensible/pcm";
                }
                else
                {
                    throw new NotSupportedException("unsupported WAVEFORMATEXTENSIBLE subformat " + ext.SubFormat);
                }
            }
            else if (tag == AudioConstants.WAVE_FORMAT_IEEE_FLOAT)
            {
                f.IsFloat = true;
                f.FormatName = "float";
            }
            else if (tag != AudioConstants.WAVE_FORMAT_PCM)
            {
                throw new NotSupportedException("unsupported mix format tag 0x" + tag.ToString("X4"));
            }
            if (f.BlockAlign <= 0) f.BlockAlign = f.Channels * f.BitsPerSample / 8;
            return f;
        }
    }

    /// <summary>
    /// Thin wrapper over the WASAPI shared-mode loopback capture on the default render endpoint.
    /// Single capture client; caller polls GetNextPacketSize, drains with GetBuffer/ReleaseBuffer.
    /// </summary>
    internal sealed class WasapiLoopbackCapture : IDisposable
    {
        private IAudioClient _client;
        private IAudioCaptureClient _capture;
        private IMMDevice _device;
        private IMMDeviceEnumerator _enumerator;
        private bool _started;
        private IntPtr _mixFormatPtr = IntPtr.Zero;

        public CaptureFormat Format { get; private set; }
        public uint BufferFrames { get; private set; }
        public double StreamLatencyMs { get; private set; }
        public string DeviceId { get; private set; }

        public static WasapiLoopbackCapture Open(int role, long bufferDurationHns)
        {
            WasapiLoopbackCapture cap = new WasapiLoopbackCapture();
            try
            {
                cap.OpenInternal(role, bufferDurationHns);
                return cap;
            }
            catch
            {
                cap.Dispose();
                throw;
            }
        }

        private void OpenInternal(int role, long bufferDurationHns)
        {
            _enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            int hr = _enumerator.GetDefaultAudioEndpoint(AudioConstants.eRender, role, out _device);
            Check(hr, "IMMDeviceEnumerator.GetDefaultAudioEndpoint");
            try
            {
                string id;
                _device.GetId(out id);
                DeviceId = id;
            }
            catch
            {
                DeviceId = "<unknown>";
            }

            Guid iid = AudioGuids.IID_IAudioClient;
            IntPtr pClient;
            hr = _device.Activate(ref iid, AudioConstants.CLSCTX_ALL, IntPtr.Zero, out pClient);
            Check(hr, "IMMDevice.Activate(IAudioClient)");
            try
            {
                _client = (IAudioClient)Marshal.GetObjectForIUnknown(pClient);
            }
            finally
            {
                Marshal.Release(pClient);
            }

            hr = _client.GetMixFormat(out _mixFormatPtr);
            Check(hr, "IAudioClient.GetMixFormat");
            Format = CaptureFormat.FromMixFormat(_mixFormatPtr);

            // Shared mode: periodicity must be 0. 1 s buffer is well above the engine period and
            // keeps polling cheap; packet size (what actually matters) is the engine period ~10 ms.
            hr = _client.Initialize(AudioConstants.AUDCLNT_SHAREMODE_SHARED,
                                    AudioConstants.AUDCLNT_STREAMFLAGS_LOOPBACK,
                                    bufferDurationHns, 0, _mixFormatPtr, IntPtr.Zero);
            Check(hr, "IAudioClient.Initialize(loopback)");

            uint frames;
            hr = _client.GetBufferSize(out frames);
            Check(hr, "IAudioClient.GetBufferSize");
            BufferFrames = frames;

            long latencyHns;
            hr = _client.GetStreamLatency(out latencyHns);
            if (hr == 0) StreamLatencyMs = latencyHns / 10000.0;

            Guid capIid = AudioGuids.IID_IAudioCaptureClient;
            IntPtr pCapture;
            hr = _client.GetService(ref capIid, out pCapture);
            Check(hr, "IAudioClient.GetService(IAudioCaptureClient)");
            try
            {
                _capture = (IAudioCaptureClient)Marshal.GetObjectForIUnknown(pCapture);
            }
            finally
            {
                Marshal.Release(pCapture);
            }
        }

        public void Start()
        {
            int hr = _client.Start();
            Check(hr, "IAudioClient.Start");
            _started = true;
        }

        public void Stop()
        {
            if (!_started) return;
            _started = false;
            try
            {
                _client.Stop();
            }
            catch
            {
                // device may have been removed
            }
        }

        public int GetNextPacketSize()
        {
            uint frames;
            int hr = _capture.GetNextPacketSize(out frames);
            Check(hr, "IAudioCaptureClient.GetNextPacketSize");
            return (int)frames;
        }

        public int GetBuffer(out IntPtr data, out int frames, out int flags,
                             out ulong devicePosition, out ulong qpcPosition)
        {
            uint f;
            int hr = _capture.GetBuffer(out data, out f, out flags, out devicePosition, out qpcPosition);
            frames = (int)f;
            return hr;
        }

        public void ReleaseBuffer(int frames)
        {
            int hr = _capture.ReleaseBuffer((uint)frames);
            Check(hr, "IAudioCaptureClient.ReleaseBuffer");
        }

        internal static void Check(int hr, string what)
        {
            if (hr < 0) throw new COMException(what + " failed hresult=0x" + hr.ToString("X8"), hr);
        }

        /// <summary>Device id of the current default render endpoint (for output-device change detection).</summary>
        public static string GetDefaultRenderDeviceId(int role)
        {
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device = null;
            try
            {
                int hr = enumerator.GetDefaultAudioEndpoint(AudioConstants.eRender, role, out device);
                Check(hr, "IMMDeviceEnumerator.GetDefaultAudioEndpoint");
                string id;
                device.GetId(out id);
                return id;
            }
            finally
            {
                if (device != null)
                {
                    try { Marshal.ReleaseComObject(device); } catch { }
                }
                try { Marshal.ReleaseComObject(enumerator); } catch { }
            }
        }

        public void Dispose()
        {
            Stop();
            if (_capture != null)
            {
                try { Marshal.ReleaseComObject(_capture); }
                catch { }
                _capture = null;
            }
            if (_client != null)
            {
                try { Marshal.ReleaseComObject(_client); }
                catch { }
                _client = null;
            }
            if (_device != null)
            {
                try { Marshal.ReleaseComObject(_device); }
                catch { }
                _device = null;
            }
            if (_enumerator != null)
            {
                try { Marshal.ReleaseComObject(_enumerator); }
                catch { }
                _enumerator = null;
            }
            if (_mixFormatPtr != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(_mixFormatPtr);
                _mixFormatPtr = IntPtr.Zero;
            }
            GC.SuppressFinalize(this);
        }
    }
}
