param(
    [switch]$SkipMenuClick,
    [switch]$StayOpen,
    [string]$Name = "cycle"
)
# Full integration cycle: focus SPW, open 更多 menu (hover + click, verified via plugin log),
# click Folia, wait for helper, screenshot, send ESC to helper window, screenshot, report state.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CycW {
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
  public static string MinOthers() {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      try {
        var pr = System.Diagnostics.Process.GetProcessById((int)p);
        string n = pr.ProcessName;
        if ((n == "DSH Desktop" || n == "WinIsland") && IsWindowVisible(h)) { ShowWindow(h, 6); sb.AppendLine("min " + n); }
      } catch {}
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
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
  public static string List(uint pid) {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid) {
        var t = new StringBuilder(512); GetWindowText(h, t, 512);
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        RECT r; GetWindowRect(h, out r);
        sb.AppendLine("hwnd=" + h + " vis=" + IsWindowVisible(h) + " class=" + c + " title=" + t + " rect=" + r.Left + "," + r.Top + " " + (r.Right-r.Left) + "x" + (r.Bottom-r.Top));
      }
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  public static void Focus(IntPtr h) { ShowWindow(h, 9); MoveWindow(h, 200, 200, 1500, 1081, true); BringWindowToTop(h); SetForegroundWindow(h); ShowWindow(h, 9); SetForegroundWindow(h); }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(180); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
  public static void Esc() { keybd_event(0x1B, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(80); keybd_event(0x1B, 0, 2, UIntPtr.Zero); }
}
"@
[CycW]::SetProcessDPIAware() | Out-Null
$screenshot = 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1'
$logPath = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY\spw-folia.log"

function CountLines([string]$pattern) {
    if (-not (Test-Path $logPath)) { return 0 }
    return (Select-String -Path $logPath -Pattern $pattern -SimpleMatch -ErrorAction SilentlyContinue | Measure-Object).Count
}

$spw = Get-Process 'Salt Player for Windows' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $spw) { Write-Output 'ERROR: SPW not running'; exit 1 }
$spwPid = [uint32]$spw.Id
$hwnd = [CycW]::FindSpw($spwPid)
Write-Output "SPW pid=$spwPid hwnd=$hwnd"
Write-Output ([CycW]::MinOthers())
Start-Sleep -Milliseconds 400
[CycW]::Focus($hwnd)
Start-Sleep -Milliseconds 900

if (-not $SkipMenuClick) {
    $appended = CountLines 'Folia item appended'
    $opened = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        # reveal bar controls: move cursor onto the bar in small steps (generates mouse-move events)
        [CycW]::MoveTo(1280, 1170); Start-Sleep -Milliseconds 250
        [CycW]::MoveTo(1320, 1170); Start-Sleep -Milliseconds 250
        [CycW]::MoveTo(1350, 1172); Start-Sleep -Milliseconds 600
        [CycW]::Click(1291, 1175)   # "..." more button
        Start-Sleep -Milliseconds 1100
        $now = CountLines 'Folia item appended'
        Write-Output ("menu attempt " + $attempt + ": appended-lines " + $appended + " -> " + $now)
        if ($now -gt $appended) { $opened = $true; break }
        Start-Sleep -Milliseconds 400
    }
    if (-not $opened) { Write-Output 'WARN: 更多 menu did not open (no new appended line)'; & $screenshot -Name "$Name-nomenu" | Out-Null }
}

$clickedBefore = CountLines 'Folia item clicked'
[CycW]::Click(1285, 1101)       # Folia item (4th row area text line)
Write-Output 'clicked Folia item area'

$helper = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 200
    if ((CountLines 'Folia item clicked') -gt $clickedBefore) {
        $helper = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($helper) { break }
    }
}
if (-not $helper) { Write-Output 'ERROR: helper process did not appear'; & $screenshot -Name "$Name-nospawn" | Out-Null; exit 2 }
$hPid = [uint32]$helper.Id
Write-Output ("helper pid=$hPid hwnd=" + $helper.MainWindowHandle)
Start-Sleep -Milliseconds 2800
& $screenshot -Name "$Name-open" | Out-Null

if ($StayOpen) {
    Write-Output ("STAY-OPEN helper pid=" + $hPid + " hwnd=" + $helper.MainWindowHandle)
    exit 0
}

# focus the helper window and send ESC
$hh = [CycW]::FindSpw($hPid)
if ($hh -eq [IntPtr]::Zero) { $hh = $helper.MainWindowHandle }
Write-Output ("helper hwnd=" + $hh)
[CycW]::ShowWindow($hh, 9) | Out-Null
[CycW]::BringWindowToTop($hh) | Out-Null
[CycW]::SetForegroundWindow($hh) | Out-Null
Start-Sleep -Milliseconds 700
[CycW]::Esc()
Start-Sleep -Milliseconds 2000
& $screenshot -Name "$Name-esc" | Out-Null

$still = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
if ($still) { Write-Output ("HELPER STILL RUNNING pid=" + $still.Id) } else { Write-Output 'helper process gone after ESC' }
Write-Output '--- log tail ---'
Get-Content -Path $logPath -Tail 10
