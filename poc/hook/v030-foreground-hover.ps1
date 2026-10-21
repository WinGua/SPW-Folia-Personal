param(
    [string]$Name = "v030-expanded",
    [int]$HoverX = 1594,
    [int]$HoverY = 1900,
    [int]$HoverMs = 1400
)
# v0.3.0 acceptance phase B2: bring the Folia host window to the foreground, hover the
# collapsed playback pill, screenshot the expanded bar. Prints every visible host window.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class V30F {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  static IntPtr best = IntPtr.Zero;
  static int bestArea = 0;
  public static string ForegroundHost() {
    uint target = 0;
    var procs = System.Diagnostics.Process.GetProcessesByName("spw-folia-host");
    if (procs.Length == 0) return "ERROR: no spw-folia-host process";
    target = (uint)procs[0].Id;
    var sb = new StringBuilder();
    best = IntPtr.Zero; bestArea = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != target) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      RECT r; GetWindowRect(h, out r);
      bool vis = IsWindowVisible(h);
      sb.AppendLine("host hwnd=" + h + " vis=" + vis + " class=" + c + " title=" + t + " rect=" + r.Left + "," + r.Top + " " + (r.Right-r.Left) + "x" + (r.Bottom-r.Top));
      if (vis) {
        int area = (r.Right-r.Left) * (r.Bottom-r.Top);
        if (area > bestArea) { bestArea = area; best = h; }
      }
      return true;
    }, IntPtr.Zero);
    if (best == IntPtr.Zero) return sb.ToString() + "ERROR: no visible host window";
    ShowWindow(best, 9);
    BringWindowToTop(best);
    SetForegroundWindow(best);
    ShowWindow(best, 9);
    sb.AppendLine("foregrounded hwnd=" + best + " area=" + bestArea);
    return sb.ToString();
  }
}
"@
[V30F]::SetProcessDPIAware() | Out-Null
Write-Output ([V30F]::ForegroundHost())
Start-Sleep -Milliseconds 700
[V30F]::SetCursorPos($HoverX, $HoverY) | Out-Null
Start-Sleep -Milliseconds 200
[V30F]::SetCursorPos($HoverX + 2, $HoverY) | Out-Null
Start-Sleep -Milliseconds $HoverMs
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name $Name | Out-Null
Write-Output "hovered at $HoverX,$HoverY for ${HoverMs}ms; shot $Name"
