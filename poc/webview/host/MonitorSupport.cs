// MonitorSupport.cs - picks the monitor that hosts the SPW window which spawned the helper.
//
// The helper is a child of the SPW (javaw.exe) process, so the parent PID is the reliable anchor on
// multi-monitor setups where the system primary screen is *not* where SPW is running. The previous
// host always fullscreened on Screen.PrimaryScreen, which put the visualizer on the wrong monitor
// and also left no way to move it (borderless window, no caption).
//
// C# 5 only (in-box .NET Framework 4.8 csc.exe).
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace SpwFolia
{
    internal static class MonitorSupport
    {
        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc proc, IntPtr param);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect rect);

        [DllImport("user32.dll")]
        private static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hWnd, int index);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr param);

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeRect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        private const uint GW_OWNER = 4;
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TOOLWINDOW = 0x00000080;

        /// <summary>
        /// Monitor of the largest visible, unowned, non-tool top-level window owned by <paramref name="pid"/>.
        /// Falls back to the primary screen when the PID is unknown or owns no such window.
        /// </summary>
        public static Screen ScreenForProcess(int pid)
        {
            if (pid <= 0) return Screen.PrimaryScreen;
            IntPtr best = IntPtr.Zero;
            long bestArea = 0;
            try
            {
                EnumWindows(delegate(IntPtr hWnd, IntPtr param)
                {
                    uint ownerPid;
                    GetWindowThreadProcessId(hWnd, out ownerPid);
                    if (ownerPid != (uint)pid) return true;
                    if (!IsWindowVisible(hWnd)) return true;
                    // A minimised main window still reports WS_VISIBLE and its restore rect can be
                    // larger than the mini player; ignore it so the visible window wins.
                    if (IsIconic(hWnd)) return true;
                    if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return true;
                    if ((GetWindowLong(hWnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
                    NativeRect rect;
                    if (!GetWindowRect(hWnd, out rect)) return true;
                    long width = rect.Right - rect.Left;
                    long height = rect.Bottom - rect.Top;
                    if (width <= 0 || height <= 0) return true;
                    long area = width * height;
                    if (area > bestArea)
                    {
                        bestArea = area;
                        best = hWnd;
                    }
                    return true;
                }, IntPtr.Zero);
            }
            catch (Exception) { }
            if (best == IntPtr.Zero) return Screen.PrimaryScreen;
            try { return Screen.FromHandle(best); }
            catch (Exception) { return Screen.PrimaryScreen; }
        }
    }
}
