param(
  [string]$Spmod = "D:\输出目录\dsh2\dist\spw-folia-0.1.0.spmod",
  [string]$ClassesSpmod = "",   # optional: .spmod whose classes/ replace the release classes
  [switch]$Restart,
  [switch]$NoBackup
)
$ErrorActionPreference = "Stop"
$pluginsRoot = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins"
$installDir = Join-Path $pluginsRoot "dev.spw.folia-0.1.0-LOCAL-ONLY"
$backupRoot = "D:\输出目录\dsh2\spw-folia\notes"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$pluginId = "dev.spw.folia"
$pyExtract = 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2]); print("extracted", sys.argv[1], "->", sys.argv[2])'

function Sha256([string]$p) { (Get-FileHash -Algorithm SHA256 -Path $p).Hash.ToLower() }

if (-not $NoBackup) {
  $bk = Join-Path $backupRoot "appdata-backup-$stamp"
  New-Item -ItemType Directory -Force -Path $bk | Out-Null
  foreach ($f in @("enabled.txt","permissions.json")) {
    $src = Join-Path $pluginsRoot $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $bk $f) -Force }
  }
  Write-Output "backup -> $bk"
}

# stop SPW tree first so plugin/host processes release files
$spw = Get-Process "Salt Player for Windows" -ErrorAction SilentlyContinue
foreach ($p in $spw) { & taskkill /PID $p.Id /T /F 2>$null | Out-Null }
Start-Sleep -Milliseconds 1500

if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir -ErrorAction Stop }
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
& python -c $pyExtract $Spmod $installDir

if ($ClassesSpmod -and (Test-Path $ClassesSpmod)) {
  $tmp = Join-Path $env:TEMP ("folia-classes-" + $stamp)
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  & python -c $pyExtract $ClassesSpmod $tmp
  $srcClasses = Join-Path $tmp "classes"
  $dstClasses = Join-Path $installDir "classes"
  if (-not (Test-Path $srcClasses)) { throw "no classes/ in $ClassesSpmod" }
  if (Test-Path $dstClasses) { Remove-Item -Recurse -Force $dstClasses }
  Copy-Item -Recurse -Force $srcClasses $dstClasses
  Remove-Item -Recurse -Force $tmp
  Write-Output "classes replaced from $ClassesSpmod"
}

# enabled.txt: keep existing lines, ensure our id present (CRLF, UTF-8 no BOM)
$enabled = Join-Path $pluginsRoot "enabled.txt"
$lines = @()
if (Test-Path $enabled) {
  $lines = @([IO.File]::ReadAllText($enabled) -split "`r?`n" | Where-Object { $_ -ne "" })
}
if ($lines -notcontains $pluginId) { $lines += $pluginId }
[IO.File]::WriteAllText($enabled, ($lines -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("enabled.txt -> " + ($lines -join ", "))

# permissions.json: merge our entry with both declared perms
$permPath = Join-Path $pluginsRoot "permissions.json"
$declared = @("class-transform","library-read")
$perm = @{}
if (Test-Path $permPath) {
  $raw = [IO.File]::ReadAllText($permPath).Trim()
  if ($raw) { $perm = $raw | ConvertFrom-Json -AsHashtable }
}
$perm[$pluginId] = @{ reviewed = $declared; granted = $declared }
$perm | ConvertTo-Json -Depth 6 | Set-Content -Path $permPath -Encoding utf8
Write-Output ("permissions.json -> " + ($perm | ConvertTo-Json -Depth 6 -Compress))

# payload identity
Write-Output "--- installed payload ---"
Write-Output ("spmod            " + (Sha256 $Spmod) + "  " + (Get-Item $Spmod).Length + " B")
Get-ChildItem -Recurse -File $installDir | Where-Object { $_.FullName -notmatch "\\web\\assets\\" -and $_.FullName -notmatch "\\licenses\\" } |
  Sort-Object FullName | Select-Object -First 40 | ForEach-Object {
    $rel = $_.FullName.Substring($installDir.Length + 1)
    Write-Output ("{0}  {1}  {2}" -f (Sha256 $_.FullName), $_.Length, $rel)
  }

if ($Restart) {
  Start-Process "C:\Users\24037\AppData\Local\Microsoft\WindowsApps\Salt Player for Windows.exe"
  Start-Sleep -Seconds 8
  Write-Output "SPW relaunched: $((Get-Process 'Salt Player for Windows' -ErrorAction SilentlyContinue | Measure-Object).Count) process(es)"
}
