param([string]$Name = "orphan")
# Orphan test: spawn the helper from the plugin, then kill SPW and verify no spw-folia-host.exe remains.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class OrpW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
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
  public static void Focus(IntPtr h) { ShowWindow(h, 9); MoveWindow(h, 200, 200, 1500, 1081, true); BringWindowToTop(h); SetForegroundWindow(h); }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(180); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
}
"@
[OrpW]::SetProcessDPIAware() | Out-Null
$screenshot = 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1'
$logPath = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY\spw-folia.log"
function CountLines([string]$pattern) {
    if (-not (Test-Path $logPath)) { return 0 }
    return (Select-String -Path $logPath -Pattern $pattern -SimpleMatch -ErrorAction SilentlyContinue | Measure-Object).Count
}
$spw = Get-Process 'Salt Player for Windows' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $spw) { Write-Output 'ERROR: SPW not running'; exit 1 }
$spwPid = [uint32]$spw.Id
$hwnd = [OrpW]::FindSpw($spwPid)
[OrpW]::Focus($hwnd)
Start-Sleep -Milliseconds 900
$appended = CountLines 'Folia item appended'
for ($attempt = 1; $attempt -le 3; $attempt++) {
    [OrpW]::MoveTo(1280, 1170); Start-Sleep -Milliseconds 250
    [OrpW]::MoveTo(1320, 1170); Start-Sleep -Milliseconds 250
    [OrpW]::MoveTo(1350, 1172); Start-Sleep -Milliseconds 600
    [OrpW]::Click(1291, 1175)
    Start-Sleep -Milliseconds 1100
    if ((CountLines 'Folia item appended') -gt $appended) { break }
    Start-Sleep -Milliseconds 400
}
$clicked = CountLines 'Folia item clicked'
[OrpW]::Click(1285, 1101)
$helper = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 200
    if ((CountLines 'Folia item clicked') -gt $clicked) { $helper = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1; if ($helper) { break } }
}
if (-not $helper) { Write-Output 'ERROR: helper did not spawn'; exit 2 }
Write-Output ("helper pid=" + $helper.Id + " (plugin-spawned)")
Start-Sleep -Milliseconds 2600
& $screenshot -Name "$Name-open" | Out-Null
Write-Output '--- killing SPW (simulates app shutdown / plugin unload) ---'
Stop-Process -Id $spwPid -Force -ErrorAction SilentlyContinue
Get-Process 'Salt Player for Windows' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 3500
$still = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
if ($still) { Write-Output ("ORPHAN HELPER STILL RUNNING pid=" + $still.Id) } else { Write-Output 'no orphan helper after SPW exit' }
& $screenshot -Name "$Name-after-kill" | Out-Null
Write-Output '--- relaunching SPW ---'
Start-Process 'C:\Users\24037\AppData\Local\Microsoft\WindowsApps\Salt Player for Windows.exe'
Start-Sleep -Milliseconds 9000
$new = Get-Process 'Salt Player for Windows' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($new) { Write-Output ("SPW relaunched pid=" + $new.Id) } else { Write-Output 'ERROR: SPW relaunch failed' }
Write-Output '--- log tail ---'
Get-Content -Path $logPath -Tail 8
