// DpiSupport.cs - process DPI-awareness bootstrap + diagnostics for spw-folia-host.exe.
//
// task-9 hardening: when the helper is spawned by the SPW plugin (child of javaw.exe, stdio
// redirected, cwd = plugin install dir) the window/viewport must be identical to a shell launch.
// This file guarantees the process-wide DPI awareness context explicitly instead of relying only on
// the embedded manifest, and exposes the values that are logged as protocol `log` lines so a future
// "tiny viewport" report can be diagnosed from the helper's own stdout.
//
// C# 5 only (in-box csc.exe from .NET Framework 4.8).
using System;
using System.Runtime.InteropServices;

namespace SpwFolia
{
    public static class DpiSupport
    {
        // -2 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, -3 = ..._V1, -4 = ..._V2? (see below)
        // Windows constants (winuser.h):
        //   DPI_AWARENESS_CONTEXT_UNAWARE              = (HANDLE)-1
        //   DPI_AWARENESS_CONTEXT_SYSTEM_AWARE         = (HANDLE)-2
        //   DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE    = (HANDLE)-3
        //   DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
        private static readonly IntPtr ContextPerMonitorAwareV2 = new IntPtr(-4);
        private static readonly IntPtr ContextPerMonitorAware = new IntPtr(-3);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("shcore.dll", SetLastError = true)]
        private static extern int SetProcessDpiAwareness(int value); // 0 unaware, 1 system, 2 per-monitor

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern IntPtr GetThreadDpiAwarenessContext();

        [DllImport("user32.dll")]
        private static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);

        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr hwnd);

        // NtQueryInformationProcess(ProcessBasicInformation) -> parent pid, without WMI.
        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessBasicInformation
        {
            public IntPtr Reserved1;
            public IntPtr PebBaseAddress;
            public IntPtr Reserved2_0;
            public IntPtr Reserved2_1;
            public IntPtr UniqueProcessId;
            public IntPtr InheritedFromUniqueProcessId;
        }

        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(
            IntPtr process, int infoClass, ref ProcessBasicInformation info,
            int infoLength, out int returnLength);

        private static string initResult = "not-initialized";

        /// <summary>Result of the awareness bootstrap ("pmv2", "per-monitor", "system", "unaware").</summary>
        public static string InitResult { get { return initResult; } }

        /// <summary>
        /// Called from Main() before any window is created. Order: PMv2 -> per-monitor -> system.
        /// Never throws; the embedded manifest is the primary mechanism, this is the safety net.
        /// </summary>
        public static string Init()
        {
            string before = DescribeAwareness();
            try
            {
                if (SetProcessDpiAwarenessContext(ContextPerMonitorAwareV2))
                {
                    initResult = "pmv2";
                    return initResult;
                }
            }
            catch (Exception) { }
            int err = Marshal.GetLastWin32Error();
            if (err == 5) // ERROR_ACCESS_DENIED: awareness was already set (manifest / parent), keep it
            {
                initResult = "already-set(" + before + ")";
                return initResult;
            }
            try
            {
                if (SetProcessDpiAwarenessContext(ContextPerMonitorAware))
                {
                    initResult = "per-monitor";
                    return initResult;
                }
            }
            catch (Exception) { }
            err = Marshal.GetLastWin32Error();
            if (err == 5)
            {
                initResult = "already-set(" + before + ")";
                return initResult;
            }
            try
            {
                if (SetProcessDpiAwareness(2) == 0)
                {
                    initResult = "per-monitor";
                    return initResult;
                }
            }
            catch (Exception) { }
            err = Marshal.GetLastWin32Error();
            if (err == 5) // E_ACCESSDENIED
            {
                initResult = "already-set(" + before + ")";
                return initResult;
            }
            try
            {
                if (SetProcessDPIAware())
                {
                    initResult = "system";
                    return initResult;
                }
            }
            catch (Exception) { }
            initResult = "unchanged(" + DescribeAwareness() + ")";
            return initResult;
        }

        /// <summary>"per-monitor-v2" / "per-monitor" / "system" / "unaware" / "unknown(n)".</summary>
        public static string DescribeAwareness()
        {
            try
            {
                int a = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext());
                if (a == 0) return "unaware";
                if (a == 1) return "system";
                if (a == 2) return "per-monitor";
                return "unknown(" + a + ")";
            }
            catch (Exception) { return "?"; }
        }

        /// <summary>Effective DPI of a window (0 when unavailable).</summary>
        public static int DpiForWindow(IntPtr hwnd)
        {
            try
            {
                if (hwnd == IntPtr.Zero) return 0;
                return (int)GetDpiForWindow(hwnd);
            }
            catch (Exception) { return 0; }
        }

        /// <summary>Parent process id (0 when unavailable); lets logs show javaw.exe -&gt; host.exe.</summary>
        public static int ParentProcessId()
        {
            try
            {
                ProcessBasicInformation info = new ProcessBasicInformation();
                int len;
                int status = NtQueryInformationProcess(
                    GetCurrentProcessHandle(), 0, ref info,
                    Marshal.SizeOf(typeof(ProcessBasicInformation)), out len);
                if (status != 0) return 0;
                return info.InheritedFromUniqueProcessId.ToInt32();
            }
            catch (Exception) { return 0; }
        }

        private static IntPtr GetCurrentProcessHandle()
        {
            try { return System.Diagnostics.Process.GetCurrentProcess().Handle; }
            catch (Exception) { return new IntPtr(-1); } // pseudo handle for the current process
        }
    }
}
