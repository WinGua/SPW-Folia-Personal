param(
    [string]$Name = "acc1",
    [switch]$SkipOpen
)
# Acceptance-session helper: opens Folia (via cycle-test -StayOpen), then exercises
# track change (media next/prev), pause/resume (media play-pause), seek (arrow keys).
# Saves screenshots into poc/hook/shots/<Name>-*.png and prints helper state markers.
$ErrorActionPreference = 'Stop'
$root = 'D:\输出目录\dsh2'
$shots = Join-Path $root 'poc\hook\shots'
$pluginLog = "$env:APPDATA\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY\spw-folia.log"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AccK {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[AccK]::SetProcessDPIAware() | Out-Null
function Shot([string]$tag) {
  & "$root\spw-folia\scripts\screenshot.ps1" -Name "$Name-$tag" | Out-Null
  Write-Output "shot $tag"
}
function Key([int]$vk) {
  [AccK]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 90
  [AccK]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
}
function LogTail([int]$n = 3) {
  if (Test-Path $pluginLog) { Get-Content $pluginLog -Tail $n | ForEach-Object { Write-Output ("  log: " + $_) } }
}
$countBefore = (Get-Content $pluginLog | Select-String -Pattern 'Folia item clicked' -AllMatches).Count
Write-Output "--- open phase ---"
if (-not $SkipOpen) {
  & "$root\poc\hook\cycle-test.ps1" -Name "$Name-open" -StayOpen 2>&1 | ForEach-Object { Write-Output ("  " + $_) }
}
Start-Sleep -Milliseconds 3500
$h = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Output ("helper after open: " + $(if ($h) { "pid=" + $h.Id } else { "none" }))
LogTail 4
Shot 'ready'

Write-Output "--- test1a: next track (VK_MEDIA_NEXT_TRACK) ---"
Key 0xB0
Start-Sleep -Milliseconds 2600
Shot 'next'
LogTail 5

Write-Output "--- test1b: prev track (VK_MEDIA_PREV_TRACK) ---"
Key 0xB1
Start-Sleep -Milliseconds 2600
Shot 'prev'
LogTail 5

Write-Output "--- test3a: pause (VK_MEDIA_PLAY_PAUSE) ---"
Key 0xB3
Start-Sleep -Milliseconds 2600
Shot 'pausedA'
Start-Sleep -Milliseconds 2600
Shot 'pausedB'
LogTail 5

Write-Output "--- test3b: resume ---"
Key 0xB3
Start-Sleep -Milliseconds 2600
Shot 'resumed'
LogTail 5

Write-Output "--- test2: seek via keyboard arrows (+3x5s) ---"
Key 0x27; Key 0x27; Key 0x27
Start-Sleep -Milliseconds 1500
Shot 'seek'
LogTail 6

Write-Output "--- helper state before ESC ---"
$h = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Output ("helper alive=" + [bool]$h)
Write-Output "--- close phase (ESC x2) ---"
Key 0x1B
Start-Sleep -Milliseconds 1200
Key 0x1B
Start-Sleep -Milliseconds 1800
$h = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Output ("helper after ESC: " + $(if ($h) { "STILL ALIVE pid=" + $h.Id } else { "gone" }))
Shot 'closed'
LogTail 6
