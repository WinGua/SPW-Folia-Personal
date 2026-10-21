param(
    [string]$Name = "v030-hover",
    [int]$X = 1594,
    [int]$Y = 1900,
    [int]$HoverMs = 1200
)
# v0.3.0 acceptance phase B: hover the collapsed playback pill so the full bar expands,
# then screenshot the expanded bar (physical screen coordinates, DPI-aware).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class V30H {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@
[V30H]::SetProcessDPIAware() | Out-Null
[V30H]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 200
# a second tiny move guarantees a real mouse-move event for the hover timer
[V30H]::SetCursorPos($X + 2, $Y) | Out-Null
Start-Sleep -Milliseconds $HoverMs
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name $Name | Out-Null
Write-Output "hovered at $X,$Y for ${HoverMs}ms; shot $Name"
