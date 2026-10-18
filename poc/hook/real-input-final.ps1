$ErrorActionPreference = "Continue"
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RI2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
  public static void Move(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(90);
    var a = new INPUT[1]; a[0].type = 0; a[0].mi.dx = (int)Math.Round(x * 65535.0 / 3199.0); a[0].mi.dy = (int)Math.Round(y * 65535.0 / 1999.0); a[0].mi.dwFlags = 1 | 0x8000;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT))); System.Threading.Thread.Sleep(110);
  }
  public static void Click(int x, int y) {
    Move(x, y); System.Threading.Thread.Sleep(280);
    var a = new INPUT[2]; a[0].type = 0; a[0].mi.dwFlags = 2; a[1].type = 0; a[1].mi.dwFlags = 4;
    SendInput(2, a, Marshal.SizeOf(typeof(INPUT))); System.Threading.Thread.Sleep(150);
  }
  public static void Esc() { keybd_event(0x1B,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(0x1B,0,2,UIntPtr.Zero); }
  public static IntPtr MainVisibleWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.Length > 0) { found = h; return false; } }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
# ---- DPI awareness BEFORE any cursor/coordinate Win32 call ----
$dpiOk = $false
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DPIX { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx); }
"@
  $dpiOk = [DPIX]::SetProcessDpiAwarenessContext([IntPtr](-4))
} catch { }
if (-not $dpiOk) { try { [RI2]::SetProcessDPIAware() | Out-Null } catch {} }
$p0 = New-Object RI2+POINT
[RI2]::GetCursorPos([ref]$p0) | Out-Null
Write-Output ("DPI-aware=" + $dpiOk + " cursor=(" + $p0.X + "," + $p0.Y + ")")

$acc = "D:\输出目录\dsh2\poc\hook\acceptance"
$D = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY"
function Shot([string]$n) { & 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name $n | Out-Null }
function HelperProc {
  Get-CimInstance Win32_Process -Filter "Name='spw-folia-host.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -like "*dev.spw.folia*" } | Select-Object -First 1
}
function ForegroundPid {
  $h = [RI2]::GetForegroundWindow(); $p = [uint32]0
  [RI2]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null; return $p
}
$hp = HelperProc
if (-not $hp) { Write-Output "ABORT: no helper from installed payload"; exit 1 }
Write-Output ("helper pid=" + $hp.ProcessId + " path=" + $hp.ExecutablePath)
$hwnd = [RI2]::MainVisibleWindow([uint32]$hp.ProcessId)
Write-Output ("helper hwnd=" + $hwnd + " fgPid(before)=" + (ForegroundPid))
# bring helper to front + real mouse hover to reveal chrome then click gear at physical (3136,79)
[RI2]::ShowWindow($hwnd, 9) | Out-Null; [RI2]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500
[RI2]::Move(1600, 1000); [RI2]::Move(2400, 500); [RI2]::Move(3000, 120); [RI2]::Move(3136, 79)
Start-Sleep -Milliseconds 900
Write-Output ("fgPid(at gear)=" + (ForegroundPid) + " (expect " + $hp.ProcessId + ")")
Shot "finD-hover"
Copy-Item "D:\输出目录\dsh2\poc\hook\shots\finD-hover-0.png" "$acc\finD-hover.png" -Force
if ((ForegroundPid) -ne [uint32]$hp.ProcessId) { Write-Output "WARN: helper not foreground - gating click"; }
[RI2]::Click(3136, 79)
Start-Sleep -Milliseconds 2200
Shot "finD-gear"
Copy-Item "D:\输出目录\dsh2\poc\hook\shots\finD-gear-0.png" "$acc\finD-gear-open.png" -Force
$hp2 = HelperProc
Write-Output ("after gear click helper alive=" + [bool]$hp2)
# real click on settings back arrow (physical ~533,352)
[RI2]::Click(533, 352)
Start-Sleep -Milliseconds 1700
Shot "finD-back"
Copy-Item "D:\输出目录\dsh2\poc\hook\shots\finD-back-0.png" "$acc\finD-gear-back.png" -Force
$hp3 = HelperProc
Write-Output ("after back click helper alive=" + [bool]$hp3)
# ESC should now close the WINDOW (overlay already closed by real back click)
[RI2]::Esc()
Start-Sleep -Milliseconds 1800
Shot "finD-esc"
Copy-Item "D:\输出目录\dsh2\poc\hook\shots\finD-esc-0.png" "$acc\finD-esc.png" -Force
$hp4 = HelperProc
Write-Output ("after ESC helper alive=" + [bool]$hp4)
Write-Output ("fgPid(final)=" + (ForegroundPid))
Copy-Item (Join-Path $D "spw-folia.log") "$acc\finD-plugin.log" -Force
if (Test-Path (Join-Path $D "spw-folia-host.stdout.log")) { Copy-Item (Join-Path $D "spw-folia-host.stdout.log") "$acc\finD-host-stdout.log" -Force; Write-Output "stdout copied" }
Write-Output "=== key log lines ==="
Select-String -Path (Join-Path $D "spw-folia.log") -Pattern "Folia item clicked|spawn exe=|host spawned|geometry reason|page-viewport|host closed|host-exit|host cleanup|settings" | Select-Object -Last 14 | ForEach-Object { $_.Line }
