param(
    [string]$Name = "lifecycle"
)
# Test 5: plugin disable (enabled.txt) -> restart -> no plugin; re-enable -> restart -> menu item works.
$ErrorActionPreference = 'Continue'
$appdata = "$env:APPDATA\Salt Player for Windows"
$plugins = "$appdata\workshop\plugins"
$pluginId = "dev.spw.folia"
$enabled = "$plugins\enabled.txt"
$launchExe = "$env:LOCALAPPDATA\Microsoft\WindowsApps\Salt Player for Windows.exe"
$log = "$plugins\dev.spw.folia-0.1.0-LOCAL-ONLY\spw-folia.log"
$shots = 'D:\输出目录\dsh2\poc\hook\shots'

function Get-SPW { Get-Process 'Salt Player for Windows' -ErrorAction SilentlyContinue }
function Stop-SPW {
  Get-Process 'Salt Player for Windows' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 2500
  Write-Output ("SPW procs after stop: " + @(Get-SPW).Count)
}
function Start-SPW {
  Start-Process -FilePath $launchExe | Out-Null
  Start-Sleep -Seconds 12
  Write-Output ("SPW launched, procs=" + @(Get-SPW).Count)
}
function LogStartCount {
  if (Test-Path $log) { return @(Select-String -Path $log -Pattern 'version=0.1.0 spw=').Count } else { return 0 }
}
function Close-Helper {
  $h = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $h) { return }
  # focus + ESC via drive sequence is unreliable here; use taskkill for lifecycle smoke
  Stop-Process -Id $h.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1200
}

# backup enabled.txt
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "D:\输出目录\dsh2\spw-folia\notes\appdata-backup-$stamp-lifecycle"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item $enabled "$backup\enabled.txt" -Force -ErrorAction SilentlyContinue
Copy-Item "$plugins\permissions.json" "$backup\permissions.json" -Force -ErrorAction SilentlyContinue
Write-Output "backup dir: $backup"

# --- 1. disable plugin ---
Close-Helper
Stop-SPW
$lines = @(Get-Content $enabled) | Where-Object { $_.Trim() -ne $pluginId -and $_.Trim() -ne '' }
[System.IO.File]::WriteAllText($enabled, (($lines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("enabled.txt (disabled): " + ((Get-Content $enabled) -join ' | '))
$startBefore = LogStartCount
Start-SPW
$startAfter = LogStartCount
Write-Output ("plugin start lines before=$startBefore after=$startAfter (expect equal => plugin disabled)")
# menu check: open 更多 and screenshot: should have only 4 items (no Folia)
& 'D:\输出目录\dsh2\poc\hook\drive.ps1' -Name "$Name-disabled" -Clicks '1291,1175' -WaitAfter 1600 2>&1 | Out-Null
Start-Sleep -Milliseconds 800
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name "$Name-disabled-menu" | Out-Null
Write-Output "disabled-menu screenshot done"

# --- 2. re-enable plugin ---
Stop-SPW
$lines = @(Get-Content $enabled) | Where-Object { $_.Trim() -ne '' }
$lines += $pluginId
[System.IO.File]::WriteAllText($enabled, (($lines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("enabled.txt (enabled): " + ((Get-Content $enabled) -join ' | '))
$startBefore = LogStartCount
Start-SPW
$startAfter = LogStartCount
Write-Output ("plugin start lines before=$startBefore after=$startAfter (expect increased => plugin loaded)")
# open menu -> Folia -> helper
& 'D:\输出目录\dsh2\poc\hook\cycle-test.ps1' -Name "$Name-reenabled" -StayOpen 2>&1 | Select-Object -Last 4
Start-Sleep -Milliseconds 4000
$h = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Output ("helper after re-enable: " + $(if ($h) { "pid=" + $h.Id } else { "none" }))
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name "$Name-reenabled-window" | Out-Null
# close helper via taskkill (lifecycle smoke only)
Close-Helper
Write-Output ("helper after cleanup: " + @(Get-Process spw-folia-host -ErrorAction SilentlyContinue).Count)
Write-Output ("log start lines total: " + (LogStartCount))
