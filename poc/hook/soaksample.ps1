$ErrorActionPreference = "Continue"
$acc = "D:\输出目录\dsh2\poc\hook"
$log = Join-Path $acc "logs\soak-final.log"
$D = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY"
$pluginLog = Join-Path $D "spw-folia.log"
$stdoutLog = Join-Path $D "spw-folia-host.stdout.log"
"" | Set-Content $log -Encoding utf8
Add-Content $log ("soak started " + (Get-Date -Format o)) -Encoding utf8
$samples = 8
$interval = 110
for ($i = 1; $i -le $samples; $i++) {
  Start-Sleep -Seconds $(if ($i -eq 1) { 15 } else { $interval })
  $h = Get-CimInstance Win32_Process -Filter "Name='spw-folia-host.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like '*dev.spw.folia*' } | Select-Object -First 1
  $alive = [bool]$h
  $proc = if ($h) { Get-Process -Id $h.ProcessId -ErrorAction SilentlyContinue } else { $null }
  $fpsLine = if (Test-Path $stdoutLog) { (Select-String -Path $stdoutLog -Pattern '"t":"fps"' | Select-Object -Last 1).Line } else { "" }
  $heap = ""; $fps = ""; $canv = ""; $vp = ""
  if ($fpsLine -match '"fps":([0-9.]+)') { $fps = $Matches[1] }
  if ($fpsLine -match '"heapMB":([0-9.]+)') { $heap = $Matches[1] }
  if ($fpsLine -match '"canvases":([0-9]+)') { $canv = $Matches[1] }
  if ($fpsLine -match '"w":([0-9]+),"h":([0-9]+)') { $vp = $Matches[1] + "x" + $Matches[2] }
  $stateLine = (Select-String -Path $pluginLog -Pattern 'state -> helper' | Select-Object -Last 1).Line
  $pos = ""; $playing = ""
  if ($stateLine -match 'pos=(-?[0-9]+)') { $pos = $Matches[1] }
  if ($stateLine -match 'playing=(true|false)') { $playing = $Matches[1] }
  $errCount = 0
  if (Test-Path $stdoutLog) { $errCount = (Select-String -Path $stdoutLog -Pattern '"level":"error"').Count }
  $ws = if ($proc) { [math]::Round($proc.WorkingSet64 / 1MB, 1) } else { 0 }
  $line = ("sample {0}/{1} t={2} helperAlive={3} wsMB={4} fps={5} heapMB={6} canvases={7} viewport={8} pos={9} playing={10} stderrLines={11}" -f $i, $samples, (Get-Date -Format "HH:mm:ss"), $alive, $ws, $fps, $heap, $canv, $vp, $pos, $playing, $errCount)
  Add-Content $log $line -Encoding utf8
  if (-not $alive) { Add-Content $log "helper died; stopping samples" -Encoding utf8; break }
}
Add-Content $log ("soak finished " + (Get-Date -Format o)) -Encoding utf8
Get-Content $log | Write-Output
