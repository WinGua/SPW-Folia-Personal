param(
    [int]$SPW = 19076,
    [string]$Name = "atomic"
)
# Atomic: minimize DSH windows, restore+focus SPW, screenshot, click, screenshot, dump windows.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class AtomW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static string MinDsh() {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      try {
        var pr = System.Diagnostics.Process.GetProcessById((int)p);
        if (pr.ProcessName == "DSH Desktop" && IsWindowVisible(h)) {
          var t = new StringBuilder(512); GetWindowText(h, t, 512);
          if (t.Length > 0) { ShowWindow(h, 6); sb.AppendLine("minimized dsh hwnd=" + h + " title=" + t); }
        }
      } catch {}
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  public static string Dump(uint pid) {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid) {
        var t = new StringBuilder(512); GetWindowText(h, t, 512);
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        RECT r; GetWindowRect(h, out r);
        sb.AppendLine(string.Format("hwnd={0} vis={1} class={2} title={3} rect={4},{5} {6}x{7}", h, IsWindowVisible(h), c, t, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top));
      }
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  public static void Focus(IntPtr h) {
    ShowWindow(h, 9);
    MoveWindow(h, 200, 200, 1500, 1081, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    ShowWindow(h, 9);
    SetForegroundWindow(h);
  }
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(150);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(90);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
}
"@
[AtomW]::SetProcessDPIAware() | Out-Null

# find SPW main hwnd
$hwnd = [IntPtr]::Zero
$sb = New-Object System.Text.StringBuilder
# use Dump to locate SunAwtFrame: parse
$dump = [AtomW]::Dump([uint32]$SPW)
$lines = $dump -split "`r?`n" | Where-Object { $_ -match 'SunAwtFrame' }
if ($lines.Count -gt 0 -and $lines[0] -match 'hwnd=(\d+)') { $hwnd = [IntPtr][int64]$Matches[1] }
Write-Output "SPW hwnd=$hwnd"
Write-Output ([AtomW]::MinDsh())
Start-Sleep -Milliseconds 400
[AtomW]::Focus($hwnd)
Start-Sleep -Milliseconds 700
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name "$Name-before" | Out-Null
Write-Output "--- windows before click ---"
Write-Output ([AtomW]::Dump([uint32]$SPW))
[AtomW]::Click(1400, 252)
Start-Sleep -Milliseconds 900
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name "$Name-after" | Out-Null
Write-Output "--- windows after click ---"
Write-Output ([AtomW]::Dump([uint32]$SPW))
