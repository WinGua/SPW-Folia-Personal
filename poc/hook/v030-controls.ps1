param(
    [string]$Name = "v030-controls",
    [switch]$SkipOpen
)
# v0.3.0 real-SPW acceptance (compact, log-based): open Folia, then drive the playback bar
# with real mouse input and verify each control through the plugin log markers:
#   play/pause -> state lines with playing=true/false
#   next/prev  -> track pushes
#   shuffle    -> queue pushes with mode random/circle
#   playlist   -> panel opens (one screenshot) and a row click changes the current index
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class V30C {
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
  static IntPtr best = IntPtr.Zero; static int bestArea = 0;
  public static string MinOthers() {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      try {
        var pr = System.Diagnostics.Process.GetProcessById((int)p);
        string n = pr.ProcessName;
        if ((n == "DSH Desktop" || n == "WinIsland" || n == "msedge") && IsWindowVisible(h)) { ShowWindow(h, 6); sb.AppendLine("min " + n); }
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
  public static string ForegroundHost() {
    var procs = System.Diagnostics.Process.GetProcessesByName("spw-folia-host");
    if (procs.Length == 0) return "ERROR: no spw-folia-host process";
    uint target = (uint)procs[0].Id;
    var sb = new StringBuilder();
    best = IntPtr.Zero; bestArea = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != target) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      RECT r; GetWindowRect(h, out r);
      bool vis = IsWindowVisible(h);
      sb.AppendLine("host hwnd=" + h + " vis=" + vis + " class=" + c + " rect=" + r.Left + "," + r.Top + " " + (r.Right-r.Left) + "x" + (r.Bottom-r.Top));
      if (vis) { int area = (r.Right-r.Left) * (r.Bottom-r.Top); if (area > bestArea) { bestArea = area; best = h; } }
      return true;
    }, IntPtr.Zero);
    if (best == IntPtr.Zero) return sb.ToString() + "ERROR: no visible host window";
    ShowWindow(best, 9); BringWindowToTop(best); SetForegroundWindow(best); ShowWindow(best, 9);
    sb.AppendLine("foregrounded hwnd=" + best + " area=" + bestArea);
    return sb.ToString();
  }
  public static void Focus(IntPtr h) { ShowWindow(h, 9); MoveWindow(h, 200, 200, 1500, 1081, true); BringWindowToTop(h); SetForegroundWindow(h); ShowWindow(h, 9); SetForegroundWindow(h); }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(120); SetCursorPos(x + 2, y); System.Threading.Thread.Sleep(120); }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(220); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(100); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
[V30C]::SetProcessDPIAware() | Out-Null
$root = 'D:\输出目录\dsh2'
$screenshot = Join-Path $root 'spw-folia\scripts\screenshot.ps1'
$logPath = 'C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.3.0-LOCAL-ONLY\spw-folia.log'

function CountHits([string]$pattern) {
    if (-not (Test-Path $logPath)) { return 0 }
    return (Select-String -Path $logPath -Pattern $pattern -SimpleMatch -ErrorAction SilentlyContinue | Measure-Object).Count
}
function LogTail([int]$n = 6) { if (Test-Path $logPath) { Get-Content $logPath -Tail $n | ForEach-Object { Write-Output ("  log: " + $_) } } }
function Shot([string]$tag) { & $screenshot -Name "$Name-$tag" | Out-Null; Write-Output "shot $Name-$tag" }

# ---------- phase 1: open Folia if needed ----------
$helper = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $helper -and -not $SkipOpen) {
    Write-Output '--- open Folia via 更多 menu ---'
    $spw = Get-Process 'Salt Player for Windows' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $spw) { Write-Output 'FAIL: SPW not running'; exit 1 }
    $hwnd = [V30C]::FindSpw([uint32]$spw.Id)
    Write-Output ([V30C]::MinOthers())
    [V30C]::Focus($hwnd)
    Start-Sleep -Milliseconds 700
    $appended = CountHits 'Folia item appended'
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        [V30C]::MoveTo(1320, 1170)
        Start-Sleep -Milliseconds 300
        [V30C]::Click(1291, 1175)
        Start-Sleep -Milliseconds 1000
        if ((CountHits 'Folia item appended') -gt $appended) { break }
    }
    [V30C]::Click(1285, 1101)
    for ($i = 0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 200
        $helper = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($helper) { break }
    }
}
if (-not $helper) { Write-Output 'FAIL: helper process did not appear'; LogTail 10; exit 2 }
Write-Output ("helper pid=" + $helper.Id)
Start-Sleep -Milliseconds 3500
Write-Output ([V30C]::ForegroundHost())
Start-Sleep -Milliseconds 600

# ---------- phase 2: hover to expand the bar ----------
[V30C]::MoveTo(1595, 1905)   # collapsed pill
Start-Sleep -Milliseconds 400
[V30C]::MoveTo(1595, 1863)   # inside expanded bar
Start-Sleep -Milliseconds 900
Shot 'expanded'

# ---------- phase 3: each control, verified by log deltas ----------
$playingBefore = CountHits 'playing=true'
[V30C]::Click(1124, 1863)    # play/pause
Start-Sleep -Milliseconds 1400
$playingAfter = CountHits 'playing=true'
Write-Output ("play toggle: playing=true lines $playingBefore -> $playingAfter")
Shot 'playing'

$trackBefore = CountHits 'replay track'
[V30C]::Click(1310, 1829)    # next
Start-Sleep -Milliseconds 1600
$trackAfter = CountHits 'replay track'
Write-Output ("next: replay-track lines $trackBefore -> $trackAfter")
Shot 'next'

$prevBefore = CountHits 'replay track'
[V30C]::Click(1231, 1829)    # previous
Start-Sleep -Milliseconds 1600
Write-Output ("prev: replay-track lines $prevBefore -> " + (CountHits 'replay track'))
Shot 'prev'

$queueBefore = CountHits 'queue -> helper'
[V30C]::Click(2027, 1829)    # shuffle
Start-Sleep -Milliseconds 1400
$queueAfter = CountHits 'queue -> helper'
Write-Output ("shuffle: queue->helper lines $queueBefore -> $queueAfter")
LogTail 2
Shot 'shuffle'

[V30C]::Click(2099, 1829)    # playlist panel
Start-Sleep -Milliseconds 900
Shot 'panel'

# row 3 of the queue panel (index 2): panel is 420 css wide, bottom 136 css; row geometry approx
$queueBefore2 = CountHits 'queue -> helper'
[V30C]::Click(1600, 1368)
Start-Sleep -Milliseconds 1800
Write-Output ("queue-play: replay-track lines " + $trackBefore + " -> " + (CountHits 'replay track') + ", queue pushes " + $queueBefore2 + " -> " + (CountHits 'queue -> helper'))
Shot 'queueplay'

Write-Output '--- plugin log tail ---'
LogTail 14
Write-Output '--- error scan ---'
if (Test-Path $logPath) {
    Select-String -Path $logPath -Pattern 'resolve failed|unavailable|Exception|ERROR|error' -SimpleMatch -ErrorAction SilentlyContinue |
        Select-Object -Last 10 | ForEach-Object { Write-Output ("  err: " + $_.Line) }
}
Write-Output '--- state summary ---'
LogTail 3
