param([string]$Name = "v030-jiggle")
# Real-SPW transparent-mode hover diagnostic: several small real mouse moves over the HUD pill,
# screenshot after; then read plugin log's playing state separately to test click forwarding.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class V30J {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@
[V30J]::SetProcessDPIAware() | Out-Null
$pts = @(@(1580,1896),@(1604,1902),@(1622,1898),@(1592,1906),@(1612,1900),@(1598,1904),@(1618,1902),@(1600,1900))
foreach ($p in $pts) { [V30J]::SetCursorPos($p[0], $p[1]) | Out-Null; Start-Sleep -Milliseconds 140 }
Start-Sleep -Milliseconds 700
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name $Name | Out-Null
Write-Output 'jiggled and shot'
