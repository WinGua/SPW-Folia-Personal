param(
    [string]$Action = "open",
    [int]$X = 0,
    [int]$Y = 0,
    [string]$Name = "v030-trans"
)
# Drive the real Folia host window: open settings (F1), optionally click a point, ESC, hover HUD.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class V30S {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr FindHost() {
    IntPtr found = IntPtr.Zero;
    foreach (var p in System.Diagnostics.Process.GetProcessesByName("spw-folia-host")) {
      uint pid = (uint)p.Id;
      EnumWindows((h, l) => {
        uint wp; GetWindowThreadProcessId(h, out wp);
        if (wp == pid && IsWindowVisible(h)) {
          RECT r; GetWindowRect(h, out r);
          if ((r.Right - r.Left) > 800) { found = h; return false; }
        }
        return true;
      }, IntPtr.Zero);
      if (found != IntPtr.Zero) break;
    }
    return found;
  }
  public static void Focus(IntPtr h) { ShowWindow(h, 9); BringWindowToTop(h); SetForegroundWindow(h); ShowWindow(h, 9); SetForegroundWindow(h); }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(180); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
[V30S]::SetProcessDPIAware() | Out-Null
$root = 'D:\输出目录\dsh2'
$shot = Join-Path $root 'spw-folia\scripts\screenshot.ps1'
$h = [V30S]::FindHost()
if ($h -eq [IntPtr]::Zero) { Write-Output 'ERROR: spw-folia-host window not found'; exit 1 }
[V30S]::Focus($h)
Start-Sleep -Milliseconds 700
Write-Output "host hwnd=$h"

if ($Action -eq "open") {
    [V30S]::Key(0x70)   # F1 -> toggle settings overlay
    Start-Sleep -Milliseconds 1100
    & $shot -Name "$Name-settings" | Out-Null
    Write-Output 'opened settings (F1) and shot'
} elseif ($Action -eq "click") {
    [V30S]::Click($X, $Y)
    Start-Sleep -Milliseconds 900
    & $shot -Name "$Name-clicked" | Out-Null
    Write-Output "clicked $X,$Y and shot"
} elseif ($Action -eq "esc") {
    [V30S]::Key(0x1B)
    Start-Sleep -Milliseconds 700
    & $shot -Name "$Name-esc" | Out-Null
    Write-Output 'sent ESC and shot'
} elseif ($Action -eq "hover") {
    [V30S]::MoveTo(1600, 1902); Start-Sleep -Milliseconds 700
    [V30S]::MoveTo(1606, 1901); Start-Sleep -Milliseconds 900
    & $shot -Name "$Name-hover" | Out-Null
    Write-Output 'hovered HUD and shot'
} elseif ($Action -eq "hoveridle") {
    [V30S]::MoveTo(500, 500); Start-Sleep -Milliseconds 3400
    & $shot -Name "$Name-idle" | Out-Null
    Write-Output 'left HUD idle and shot'
}
