param(
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y,
    [switch]$XButton1,
    [switch]$XButton2
)
# Moves the real system cursor (physical pixels) for the packaged-host acceptance scripts, and
# optionally presses a mouse side button (XBUTTON1 = "back", XBUTTON2 = "forward").
# A 1 px jiggle guarantees a new WM_MOUSEMOVE even when the target equals the current position.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SpwCursor {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
$MOUSEEVENTF_XDOWN = 0x0080
$MOUSEEVENTF_XUP = 0x0100
[SpwCursor]::SetProcessDPIAware() | Out-Null
[SpwCursor]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 40
[SpwCursor]::SetCursorPos($X + 1, $Y) | Out-Null
[SpwCursor]::SetCursorPos($X, $Y) | Out-Null
if ($XButton1 -or $XButton2) {
    $button = if ($XButton1) { 1 } else { 2 }
    Start-Sleep -Milliseconds 80
    [SpwCursor]::mouse_event($MOUSEEVENTF_XDOWN, 0, 0, $button, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [SpwCursor]::mouse_event($MOUSEEVENTF_XUP, 0, 0, $button, [UIntPtr]::Zero)
    Write-Output ("xbutton{0} at {1},{2}" -f $button, $X, $Y)
}
Write-Output ("{0} x {1}" -f [SpwCursor]::GetSystemMetrics(0), [SpwCursor]::GetSystemMetrics(1))
