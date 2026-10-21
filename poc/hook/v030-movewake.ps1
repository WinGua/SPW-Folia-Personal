param([string]$Name = "v030-movewake")
# Diagnostic: let all chrome go idle, then ONE neutral pointer move, screenshot instantly.
# If bottom-right / top-right chrome reappears, pointermove reaches the page in transparent mode.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class V30W {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@
[V30W]::SetProcessDPIAware() | Out-Null
[V30W]::SetCursorPos(300, 300) | Out-Null
Start-Sleep -Milliseconds 4200
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name "$Name-idle" | Out-Null
[V30W]::SetCursorPos(800, 500) | Out-Null
Start-Sleep -Milliseconds 450
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name "$Name-moved" | Out-Null
Write-Output 'idle + single move screenshots done'
