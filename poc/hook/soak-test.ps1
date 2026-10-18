param(
  [string]$Name = "soak",
  [int]$Samples = 6,
  [int]$IntervalSec = 120
)
$ErrorActionPreference = "Continue"
$pluginDir = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY"
$log = Join-Path $pluginDir "spw-folia.log"
$stdoutLog = Join-Path $pluginDir "spw-folia-host.stdout.log"
$out = "D:\输出目录\dsh2\poc\hook\logs\$Name.log"
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
"" | Set-Content -Path $out -Encoding utf8

function Log([string]$m) { $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Add-Content -Path $out -Value $line -Encoding utf8; Write-Output $line }

# 1) ensure SPW + our playback running: open Folia (spawns helper) and make sure playing
Log "starting soak: spawn helper via cycle-test -StayOpen"
$cyc = & 'D:\输出目录\dsh2\poc\hook\cycle-test.ps1' -Name "$Name-open" -StayOpen 2>&1 | Out-String
$pidLine = ($cyc -split "`n" | Where-Object { $_ -match "STAY-OPEN helper pid=" } | Select-Object -Last 1)
$helperPid = 0
if ($pidLine -match "pid=(\d+)") { $helperPid = [int]$Matches[1] }
Log "soak-open: $pidLine (helperPid=$helperPid)"
$started = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
Log "soak start at $started helperPid=$helperPid"

# 2) sample loop
$prevHeap = $null
for ($i = 1; $i -le $Samples; $i++) {
    Start-Sleep -Seconds $IntervalSec
    $h = Get-Process -Id $helperPid -ErrorAction SilentlyContinue
    $alive = [bool]$h
    $fps = (Get-Content -Path $log -Tail 400 | Where-Object { $_ -match "host fps:" } | Select-Object -Last 1)
    if ($fps -match '\{.*\}') { $fps = $Matches[0] } else { $fps = "n/a" }
    $heap = "n/a"; if ($fps -match '"heapMB":([0-9.]+)') { $heap = [double]$Matches[1] }
    $state = (Get-Content -Path $log -Tail 300 | Where-Object { $_ -match "state #\d+ -> helper" } | Select-Object -Last 1)
    if ($state -match 'state #(\d+) -> helper: (\{.*\})') { $stateN = [int]$Matches[1]; $stateJson = $Matches[2] } else { $stateN = -1; $stateJson = "n/a" }
    $pos = "n/a"; if ($stateJson -match '"posMs":(\d+)') { $pos = [int64]$Matches[1] }
    $playing = "n/a"; if ($stateJson -match '"playing":(true|false)') { $playing = $Matches[1] }
    # errors in plugin log after soak start (host[error] / exception), excluding known harmless startup NRE
    $since = Get-Content -Path $log | Where-Object { $_ -match "^\[" -and $_.Substring(1, 19) -ge $started }
    $errs = @($since | Where-Object { ($_ -match "host\[error\]") -and ($_ -notmatch "post-page: NullReferenceException") })
    $errCount = $errs.Count
    Log ("sample=$i alive=$alive fps=$fps heapMB=$heap state#$stateN posMs=$pos playing=$playing errors=$errCount")
    if ($errs.Count -gt 0) { $errs | Select-Object -First 3 | ForEach-Object { Log ("  ERR " + $_) } }
    $prevHeap = $heap
}
Log "soak sampler done; helper alive=$([bool](Get-Process -Id $helperPid -ErrorAction SilentlyContinue))"
