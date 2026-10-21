param(
    [string]$Name = "v030-trans-hover"
)
# Hover the HUD in the real SPW transparent-background window and capture two frames.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class V30T {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@
[V30T]::SetProcessDPIAware() | Out-Null
$root = 'D:\输出目录\dsh2'
$shot = Join-Path $root 'spw-folia\scripts\screenshot.ps1'
& $shot -Name "$Name-before" | Out-Null
Write-Output 'shot before'
[V30T]::SetCursorPos(1600, 1900) | Out-Null
Start-Sleep -Milliseconds 350
[V30T]::SetCursorPos(1602, 1901) | Out-Null
Start-Sleep -Milliseconds 900
& $shot -Name "$Name-enter1" | Out-Null
Write-Output 'shot enter1'
[V30T]::SetCursorPos(1606, 1900) | Out-Null
Start-Sleep -Milliseconds 800
& $shot -Name "$Name-enter2" | Out-Null
Write-Output 'shot enter2'
[V30T]::SetCursorPos(1610, 1899) | Out-Null
Start-Sleep -Milliseconds 800
& $shot -Name "$Name-enter3" | Out-Null
Write-Output 'shot enter3'
