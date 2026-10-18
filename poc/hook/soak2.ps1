$ErrorActionPreference = "Continue"
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class SO {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr e);
  public static IntPtr FindByPid(uint pid) { IntPtr found = IntPtr.Zero; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.Length > 0) { found = h; return false; } } return true; }, IntPtr.Zero); return found; }
  public static void Esc() { keybd_event(0x1B,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(0x1B,0,2,UIntPtr.Zero); }
}
"@
[SO]::SetProcessDPIAware() | Out-Null
$D = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY"
$pluginLog = Join-Path $D "spw-folia.log"
$stdoutLog = Join-Path $D "spw-folia-host.stdout.log"
$slog = "D:\输出目录\dsh2\poc\hook\logs\soak-final2.log"
"" | Set-Content $slog -Encoding utf8
Add-Content $slog ("soak2 started " + (Get-Date -Format o)) -Encoding utf8

# 1) close any existing helper from the installed payload (focus + ESC)
Get-CimInstance Win32_Process -Filter "Name='spw-folia-host.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -like '*dev.spw.folia*' } | ForEach-Object {
    $hw = [SO]::FindByPid([uint32]$_.ProcessId)
    if ($hw -ne [IntPtr]::Zero) {
      [SO]::ShowWindow($hw, 9) | Out-Null; [SO]::SetForegroundWindow($hw) | Out-Null; Start-Sleep -Milliseconds 600
      [SO]::Esc(); Start-Sleep -Milliseconds 1200
    }
  }
Add-Content $slog "pre-clean done" -Encoding utf8

# 2) spawn a fresh helper via menu automation
$out = & 'D:\输出目录\dsh2\poc\hook\cycle-test.ps1' -Name soak2r -StayOpen 2>&1 | Out-String
$out -split "`n" | Where-Object { $_ -match "attempt|helper pid|STAY-OPEN|ERROR|WARN" } | ForEach-Object { Add-Content $slog ("  " + $_.Trim()) -Encoding utf8 }
$h = Get-CimInstance Win32_Process -Filter "Name='spw-folia-host.exe'" | Where-Object { $_.ExecutablePath -like '*dev.spw.folia*' } | Select-Object -First 1
if (-not $h) { Add-Content $slog "ABORT: no helper after spawn" -Encoding utf8; Get-Content $slog; exit 1 }
$hpid = [uint32]$h.ProcessId
$hh = [SO]::FindByPid($hpid)
Add-Content $slog ("helper pid=" + $hpid + " hwnd=" + $hh) -Encoding utf8
Start-Sleep -Milliseconds 5000
# 3) MINIMIZE helper so stray ESC/keys cannot reach it, then put SPW in front
if ($hh -ne [IntPtr]::Zero) { [SO]::ShowWindow($hh, 6) | Out-Null }
Start-Sleep -Milliseconds 800
$spw = Get-Process 'Salt Player for Windows' | Select-Object -First 1
$sw = [SO]::FindByPid([uint32]$spw.Id)
if ($sw -ne [IntPtr]::Zero) { [SO]::ShowWindow($sw, 9) | Out-Null; [SO]::SetForegroundWindow($sw) | Out-Null }
Add-Content $slog ("helper minimized; spw hwnd=" + $sw) -Encoding utf8

# 4) 15-minute sample loop (8 x 110 s)
$samples = 8; $interval = 110
for ($i = 1; $i -le $samples; $i++) {
  Start-Sleep -Seconds $interval
  $hh2 = Get-CimInstance Win32_Process -Filter "Name='spw-folia-host.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like '*dev.spw.folia*' } | Select-Object -First 1
  $alive = [bool]$hh2
  $proc = if ($hh2) { Get-Process -Id $hh2.ProcessId -ErrorAction SilentlyContinue } else { $null }
  $fpsLine = if (Test-Path $stdoutLog) { (Select-String -Path $stdoutLog -Pattern '"t":"fps"' | Select-Object -Last 1).Line } else { "" }
  $heap=""; $fps=""; $canv=""; $vp=""
  if ($fpsLine -match '"fps":([0-9.]+)') { $fps=$Matches[1] }
  if ($fpsLine -match '"heapMB":([0-9.]+)') { $heap=$Matches[1] }
  if ($fpsLine -match '"canvases":([0-9]+)') { $canv=$Matches[1] }
  if ($fpsLine -match '"w":([0-9]+),"h":([0-9]+)') { $vp=$Matches[1]+"x"+$Matches[2] }
  $stateLine = (Select-String -Path $pluginLog -Pattern 'state -> helper' | Select-Object -Last 1).Line
  $pos=""; $playing=""
  if ($stateLine -match 'pos=(-?[0-9]+)') { $pos=$Matches[1] }
  if ($stateLine -match 'playing=(true|false)') { $playing=$Matches[1] }
  $errCount = 0; $closeLines = 0
  if (Test-Path $stdoutLog) {
    $errCount = (Select-String -Path $stdoutLog -Pattern '"level":"error"').Count
    $closeLines = (Select-String -Path $stdoutLog -Pattern '"t":"closed"').Count
  }
  $ws = if ($proc) { [math]::Round($proc.WorkingSet64 / 1MB, 1) } else { 0 }
  Add-Content $slog ("sample {0}/{1} t={2} helperAlive={3} wsMB={4} fps={5} heapMB={6} canvases={7} viewport={8} pos={9} playing={10} errLines={11} closedLines={12}" -f $i,$samples,(Get-Date -Format "HH:mm:ss"),$alive,$ws,$fps,$heap,$canv,$vp,$pos,$playing,$errCount,$closeLines) -Encoding utf8
  if (-not $alive) { Add-Content $slog "helper died; stopping samples" -Encoding utf8; break }
}
Add-Content $slog ("soak2 finished " + (Get-Date -Format o)) -Encoding utf8
Add-Content $slog "--- key plugin log lines ---" -Encoding utf8
Select-String -Path $pluginLog -Pattern "Folia item clicked|host spawned|host closed|host [a-z]+ \(.*\)|host-exit" | Select-Object -Last 12 | ForEach-Object { Add-Content $slog $_.Line -Encoding utf8 }
Get-Content $slog
