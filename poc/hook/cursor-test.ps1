param(
    [int]$IdleMs = 3200
)
# Verifies the v0.1.1 cursor-visibility fix against an already-open Folia helper window:
#  1. moving the mouse must show the system cursor
#  2. idling must hide it
#  3. moving again must show it
#  4. opening the settings overlay (F1) must force-show the cursor even while idle
#  5. real mouse click on the top-right gear must open the overlay
# Requires a running spw-folia-host (e.g. `poc/hook/cycle-test.ps1 -StayOpen`).
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CurTest {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO pci);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public static IntPtr LargestWindowForPid(uint pid) {
    IntPtr best = IntPtr.Zero; long bestArea = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) {
        RECT r; GetWindowRect(h, out r);
        long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
        if (area > bestArea) { bestArea = area; best = h; }
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }
  public static bool CursorShowing() {
    CURSORINFO ci = new CURSORINFO();
    ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
    if (!GetCursorInfo(ref ci)) return false;
    return (ci.flags & 0x1) != 0;
  }
  public static void Move(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(30); }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(160); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(80); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(70); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@

$helper = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $helper) { Write-Output 'ERROR: spw-folia-host not running (start with cycle-test.ps1 -StayOpen)'; exit 1 }
$hwnd = [CurTest]::LargestWindowForPid([uint32]$helper.Id)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output 'ERROR: helper has no visible window'; exit 1 }
Write-Output ("helper pid=" + $helper.Id + " hwnd=" + $hwnd)
[CurTest]::ShowWindow($hwnd, 9) | Out-Null
[CurTest]::BringWindowToTop($hwnd) | Out-Null
[CurTest]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500

function Report([string]$label, [bool]$showing) {
    Write-Output ("{0,-32} cursorShowing={1}" -f $label, $showing)
}

$logPath = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY\spw-folia.log"
function CursorEventCount([string]$kind) {
    if (-not (Test-Path $logPath)) { return 0 }
    return (Select-String -Path $logPath -Pattern ('cursor ' + $kind) -SimpleMatch -ErrorAction SilentlyContinue | Measure-Object).Count
}
function LastCursorEvent() {
    if (-not (Test-Path $logPath)) { return '' }
    $hit = Select-String -Path $logPath -Pattern 'cursor (show|hide)' -ErrorAction SilentlyContinue | Select-Object -Last 1
    if (-not $hit) { return '' }
    if ($hit.Line -match 'cursor hide') { return 'hide' }
    if ($hit.Line -match 'cursor show') { return 'show' }
    return ''
}
function OpenStateCount() {
    if (-not (Test-Path $logPath)) { return 0 }
    return (Select-String -Path $logPath -Pattern 'settings-ui state=open' -SimpleMatch -ErrorAction SilentlyContinue | Measure-Object).Count
}

$results = New-Object System.Collections.Generic.List[string]
$showBefore = CursorEventCount 'show'
$hideBefore = CursorEventCount 'hide'

# 1) movement shows the cursor (authoritative: helper log line "cursor show")
[CurTest]::Move(900, 700); Start-Sleep -Milliseconds 600
$r1 = (CursorEventCount 'show') -gt $showBefore
Report 'after mouse move (log: show)' $r1; $results.Add("move_show=$r1")

# 2) idling hides it (helper log line "cursor hide")
Start-Sleep -Milliseconds $IdleMs
$r2 = ((CursorEventCount 'hide') -gt $hideBefore) -and ((LastCursorEvent) -eq 'hide')
Report 'after idle (log: hide)' $r2; $results.Add("idle_hide=$r2")

# 3) movement shows it again
[CurTest]::Move(920, 720); Start-Sleep -Milliseconds 600
$r3 = (LastCursorEvent) -eq 'show'
Report 'after second move (log: show)' $r3; $results.Add("move_show2=$r3")

# 4) overlay open keeps the cursor visible while idle (F1 toggles the settings panel)
$hideAtOpen = CursorEventCount 'hide'
[CurTest]::Key(0x70)   # VK_F1
Start-Sleep -Milliseconds 900
[CurTest]::Move(800, 500)
Start-Sleep -Milliseconds $IdleMs
$r4 = ((CursorEventCount 'hide') -eq $hideAtOpen) -and ((LastCursorEvent) -eq 'show')
Report 'overlay open + idle (log: stays show)' $r4; $results.Add("overlay_keeps_cursor=$r4")

# 5) close the overlay with ESC, then verify the real gear click opens it again
[CurTest]::Key(0x1B)
Start-Sleep -Milliseconds 900
[CurTest]::Move(3100, 60); Start-Sleep -Milliseconds 600      # hover near top-right so the gear fades in
$openBefore = OpenStateCount
[CurTest]::Click(3118, 79); Start-Sleep -Milliseconds 1500   # click gear center CSS (1732,44) x DSF 1.8
$overlayOpen = (OpenStateCount) -gt $openBefore
$overlayShot = 'D:\输出目录\dsh2\poc\hook\shots\cursor-gear-click.png'
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name 'cursor-gear-click' | Out-Null
Write-Output ("gear click -> overlay log state=open: " + $overlayOpen + " (shot " + $overlayShot + ")")
$results.Add("gear_click_overlay=$overlayOpen")

[CurTest]::Key(0x1B); Start-Sleep -Milliseconds 500
[CurTest]::Key(0x1B); Start-Sleep -Milliseconds 2500
Write-Output ('--- results: ' + ($results -join ' '))
$allPass = $r1 -and $r2 -and $r3 -and $r4 -and $overlayOpen
Write-Output ('CURSOR-FIX ' + $(if ($allPass) { 'PASS' } else { 'FAIL' }))
exit $(if ($allPass) { 0 } else { 2 })
