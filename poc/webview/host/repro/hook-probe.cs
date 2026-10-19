// Minimal check: does a managed WH_MOUSE_LL hook fire in this environment? (v0.1.8 click-through fix)
// C# 5 only.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

internal static class HookProbe
{
    private const int WH_MOUSE_LL = 14;
    private static long events;
    private static IntPtr hook;
    private static LowLevelMouseProc proc;
    private static StreamWriter log;

    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetLastError();

    [STAThread]
    private static void Main()
    {
        log = new StreamWriter(@"D:\输出目录\dsh2\tmp-inspect\hookprobe.log", false, Encoding.UTF8);
        Form form = new Form();
        form.Text = "hook probe";
        form.Bounds = new System.Drawing.Rectangle(20, 20, 200, 100);
        form.ShowInTaskbar = false;
        form.Opacity = 0.01;
        proc = new LowLevelMouseProc(OnMouse);
        hook = SetWindowsHookEx(WH_MOUSE_LL, proc, IntPtr.Zero, 0);
        log.WriteLine("hook=" + hook + " lastError=" + Marshal.GetLastWin32Error());
        log.Flush();
        System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        timer.Interval = 1000;
        timer.Tick += delegate (object s, EventArgs e)
        {
            log.WriteLine("events=" + events + " hook=" + hook);
            log.Flush();
        };
        timer.Start();
        System.Windows.Forms.Timer quit = new System.Windows.Forms.Timer();
        quit.Interval = 9000;
        quit.Tick += delegate (object s, EventArgs e)
        {
            log.WriteLine("final events=" + events);
            log.Flush();
            if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
            form.Close();
        };
        quit.Start();
        Application.Run(form);
    }

    private static IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0) events++;
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }
}
