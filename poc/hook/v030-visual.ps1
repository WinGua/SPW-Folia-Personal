$ErrorActionPreference = 'Stop'
# v0.3.0 real-SPW visual acceptance for user request m00785: acrylic HUD + pointer-idle auto-hide.
$root = 'D:\输出目录\dsh2'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class V30V {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
"@
[V30V]::SetProcessDPIAware() | Out-Null
$screenshot = Join-Path $root 'spw-folia\scripts\screenshot.ps1'
$helper = Get-Process 'spw-folia-host' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $helper) { Write-Output 'ERROR: spw-folia-host not running'; exit 1 }

# 1. move onto the collapsed pill at the bottom centre -> hover expands the bar
[V30V]::SetCursorPos(1594, 1900) | Out-Null
Start-Sleep -Milliseconds 250
[V30V]::SetCursorPos(1596, 1898) | Out-Null
Start-Sleep -Milliseconds 1100
& $screenshot -Name 'v030-acrylic-expanded' | Out-Null
Write-Output 'shot v030-acrylic-expanded (hover expanded, acrylic)'

# 2. park the mouse far away and wait past the idle threshold -> bar slides down out of view
[V30V]::SetCursorPos(200, 600) | Out-Null
Start-Sleep -Milliseconds 400
[V30V]::SetCursorPos(210, 610) | Out-Null
Start-Sleep -Milliseconds 3400
& $screenshot -Name 'v030-idle-hidden' | Out-Null
Write-Output 'shot v030-idle-hidden (after ~3.4s idle)'
Write-Output "helper pid=$($helper.Id)"
