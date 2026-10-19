param(
    [string]$Name = "menu-style",
    [int]$BarX = 1291,
    [int]$BarY = 1175
)
# Render check for the injected Folia flyout item: focus SPW, open the mini-player
# 更多 menu, screenshot the flyout, close it with ESC. Does NOT click the Folia item.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class MenuShot {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr FindSpw(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) {
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        if (c.ToString() == "SunAwtFrame") { found = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string RectOf(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    return r.Left + "," + r.Top + " " + (r.Right - r.Left) + "x" + (r.Bottom - r.Top);
  }
  public static void Focus(IntPtr h) { ShowWindow(h, 9); BringWindowToTop(h); SetForegroundWindow(h); ShowWindow(h, 9); SetForegroundWindow(h); }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(180); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
  public static void Esc() { keybd_event(0x1B, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(80); keybd_event(0x1B, 0, 2, UIntPtr.Zero); }
}
"@
[MenuShot]::SetProcessDPIAware() | Out-Null

$spw = Get-Process 'Salt Player for Windows' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $spw) { Write-Output 'ERROR: SPW not running'; exit 1 }
$spwPid = [uint32]$spw.Id
$hwnd = [MenuShot]::FindSpw($spwPid)
Write-Output ("SPW pid=$spwPid hwnd=$hwnd rect=" + [MenuShot]::RectOf($hwnd))
[MenuShot]::Focus($hwnd)
Start-Sleep -Milliseconds 900

# reveal the auto-hidden mini-player bar controls, then click the "..." more button
[MenuShot]::MoveTo(1280, 1170); Start-Sleep -Milliseconds 250
[MenuShot]::MoveTo(1320, 1170); Start-Sleep -Milliseconds 250
[MenuShot]::MoveTo(1350, 1172); Start-Sleep -Milliseconds 600
[MenuShot]::Click($BarX, $BarY)
Start-Sleep -Milliseconds 1200

& "D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1" -Name "$Name-open" | Out-Null
Write-Output ("screenshot: D:\输出目录\dsh2\poc\hook\shots\$Name-open-0.png")
[MenuShot]::Esc()
Start-Sleep -Milliseconds 500
Write-Output 'done'
