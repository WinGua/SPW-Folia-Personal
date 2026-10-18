param(
    [string]$Clicks = "",      # semicolon separated "x,y" physical coords, clicked in order
    [string]$Name = "drive",
    [int]$WaitAfter = 900      # ms after each click
)
# Deterministic SPW driving: minimize competing windows, focus SPW at a fixed rect,
# optionally click a sequence of physical coords, screenshot after each click.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class DrvW {
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

  public static string MinOthers() {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      try {
        var pr = System.Diagnostics.Process.GetProcessById((int)p);
        string n = pr.ProcessName;
        if ((n == "DSH Desktop" || n == "WinIsland" || n == "spw-folia-host") && IsWindowVisible(h)) {
          var t = new StringBuilder(512); GetWindowText(h, t, 512);
          ShowWindow(h, 6);
          sb.AppendLine("minimized " + n + " hwnd=" + h + " title=" + t);
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
  public static IntPtr FindMain(uint pid) {
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
    System.Threading.Thread.Sleep(180);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(90);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
}
"@
[DrvW]::SetProcessDPIAware() | Out-Null
$shot = 'D:\输出目录\dsh2\pwsh-screenshot.ps1'
$screenshotScript = 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1'

$spw = Get-Process 'Salt Player for Windows' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $spw) { Write-Output "ERROR: SPW process not found"; exit 1 }
$pid32 = [uint32]$spw.Id
$hwnd = [DrvW]::FindMain($pid32)
Write-Output "SPW pid=$pid32 hwnd=$hwnd"
Write-Output ([DrvW]::MinOthers())
Start-Sleep -Milliseconds 500
[DrvW]::Focus($hwnd)
Start-Sleep -Milliseconds 900
& $screenshotScript -Name "$Name-0" | Out-Null
Write-Output "--- SPW windows ---"
Write-Output ([DrvW]::Dump($pid32))

$i = 1
foreach ($pair in ($Clicks -split ';')) {
    $pair = $pair.Trim()
    if ($pair -eq '') { continue }
    $xy = $pair -split ','
    $x = [int]$xy[0]; $y = [int]$xy[1]
    Write-Output ("click #" + $i + " at " + $x + "," + $y)
    [DrvW]::Click($x, $y)
    Start-Sleep -Milliseconds $WaitAfter
    & $screenshotScript -Name ("$Name-" + $i) | Out-Null
    $i++
}
Write-Output "--- SPW windows after clicks ---"
Write-Output ([DrvW]::Dump($pid32))
