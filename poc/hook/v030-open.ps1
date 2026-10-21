param(
    [string]$Name = "v030-open",
    [switch]$SkipPlayStart
)
# v0.3.0 real-SPW acceptance, phase A: start playback, open the Folia fullscreen window,
# print the plugin log markers we need to verify the playback-control reflection bridge.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class V30W {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
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
  public static void Focus(IntPtr h) { ShowWindow(h, 9); MoveWindow(h, 200, 200, 1500, 1081, true); BringWindowToTop(h); SetForegroundWindow(h); ShowWindow(h, 9); SetForegroundWindow(h); }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(180); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
[V30W]::SetProcessDPIAware() | Out-Null
$root = 'D:\输出目录\dsh2'
$screenshot = Join-Path $root 'spw-folia\scripts\screenshot.ps1'
$logPath = 'C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.3.0-LOCAL-ONLY\spw-folia.log'

function Shot([string]$tag) { & $screenshot -Name "$Name-$tag" | Out-Null; Write-Output "shot $Name-$tag" }
function CountLines([string]$pattern) {
    if (-not (Test-Path $logPath)) { return 0 }
    return (Select-String -Path $logPath -Pattern $pattern -SimpleMatch -ErrorAction SilentlyContinue | Measure-Object).Count
}
function LogTail([int]$n = 8) {
    if (Test-Path $logPath) { Get-Content $logPath -Tail $n | ForEach-Object { Write-Output ("  log: " + $_) } }
}

$spw = Get-Process 'Salt Player for Windows' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $spw) { Write-Output 'ERROR: SPW not running'; exit 1 }
$spwPid = [uint32]$spw.Id
$hwnd = [V30W]::FindSpw($spwPid)
Write-Output "SPW pid=$spwPid hwnd=$hwnd"
Write-Output ([V30W]::MinOthers())
Start-Sleep -Milliseconds 400
[V30W]::Focus($hwnd)
Start-Sleep -Milliseconds 900

if (-not $SkipPlayStart) {
    Write-Output '--- start playback (VK_MEDIA_PLAY_PAUSE) ---'
    [V30W]::Key(0xB3)
    Start-Sleep -Milliseconds 2200
    Shot 'spw-playing'
}

Write-Output '--- open 更多 menu ---'
$appended = CountLines 'Folia item appended'
$opened = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
    [V30W]::MoveTo(1280, 1170); Start-Sleep -Milliseconds 250
    [V30W]::MoveTo(1320, 1170); Start-Sleep -Milliseconds 250
    [V30W]::MoveTo(1350, 1172); Start-Sleep -Milliseconds 600
    [V30W]::Click(1291, 1175)
    Start-Sleep -Milliseconds 1100
    $now = CountLines 'Folia item appended'
    Write-Output ("menu attempt " + $attempt + ": appended-lines " + $appended + " -> " + $now)
    if ($now -gt $appended) { $opened = $true; break }
    Start-Sleep -Milliseconds 400
}
if (-not $opened) { Write-Output 'WARN: 更多 menu did not open (no new appended line)'; Shot 'nomenu' }

$clickedBefore = CountLines 'Folia item clicked'
[V30W]::Click(1285, 1101)
Write-Output 'clicked Folia item area'

$helper = $null
for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 200
    $helper = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($helper) { break }
}
if (-not $helper) { Write-Output 'ERROR: helper process did not appear'; Shot 'nospawn'; LogTail 12; exit 2 }
Write-Output ("helper pid=" + $helper.Id + " hwnd=" + $helper.MainWindowHandle)
Start-Sleep -Milliseconds 4500
Shot 'folia-open'
Write-Output '--- log tail (control bridge markers) ---'
LogTail 20
Write-Output '--- control-related log lines ---'
if (Test-Path $logPath) {
    Select-String -Path $logPath -Pattern 'playback controls|queue ->|control|resolve' -SimpleMatch -ErrorAction SilentlyContinue |
        Select-Object -Last 15 | ForEach-Object { Write-Output ("  hit: " + $_.Line) }
}
Write-Output "STAY-OPEN helper pid=$($helper.Id)"
