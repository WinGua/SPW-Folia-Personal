$ErrorActionPreference = "Continue"
$D = "C:\Users\24037\AppData\Roaming\Salt Player for Windows\workshop\plugins\dev.spw.folia-0.1.0-LOCAL-ONLY"
$acc = "D:\输出目录\dsh2\poc\hook\acceptance"
function Log([string]$m) { Write-Output ("[" + (Get-Date -Format "HH:mm:ss") + "] " + $m) }
function Shot([string]$n) {
  Log "SHOT $n"
  # minimize other windows that steal foreground
  Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [MM]::ShowWindow($_.MainWindowHandle, 6) | Out-Null }
  Get-Process SystemSettings,ApplicationFrameHost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [MM]::ShowWindow($_.MainWindowHandle, 6) | Out-Null }
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MM2 { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }
"@
Log ("helper alive at start=" + [bool](Get-Process spw-folia-host -ErrorAction SilentlyContinue))
# spawn helper via menu (cycle-test does focus + hover + click + verify spawn)
$out = & 'D:\输出目录\dsh2\poc\hook\cycle-test.ps1' -Name finA -StayOpen 2>&1 | Out-String
$out -split "`n" | Where-Object { $_ -match "attempt|helper pid|STAY-OPEN|WARN|ERROR|clicked" } | ForEach-Object { Log ("  " + $_.Trim()) }
$helper = Get-Process spw-folia-host -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $helper) { Log "ABORT: no helper spawned"; exit 1 }
Log ("helper pid=" + $helper.Id)
Start-Sleep -Milliseconds 6000
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name finA-full | Out-Null
Copy-Item "D:\输出目录\dsh2\poc\hook\shots\finA-full-0.png" "$acc\finA-fullscreen.png" -Force
Log "fullscreen screenshot saved"
# real mouse: hover top-right then click the in-page gear (physical 3136,79)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RG {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx; public int dy; public uint md; public uint fl; public uint t; public IntPtr ex; }
  [StructLayout(LayoutKind.Sequential)] public struct IN { public uint type; public MI mi; public int p1; public int p2; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, IN[] i, int size);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr e);
  public static void Move(int x, int y) { var a = new IN[1]; a[0].type = 0; a[0].mi.dx = (int)Math.Round(x * 65535.0 / 3199.0); a[0].mi.dy = (int)Math.Round(y * 65535.0 / 1999.0); a[0].mi.fl = 1 | 0x8000; SendInput(1, a, Marshal.SizeOf(typeof(IN))); System.Threading.Thread.Sleep(150); }
  public static void Click(int x, int y) { Move(x, y); System.Threading.Thread.Sleep(280); var a = new IN[2]; a[0].type = 0; a[0].mi.fl = 2; a[1].type = 0; a[1].mi.fl = 4; SendInput(2, a, Marshal.SizeOf(typeof(IN))); System.Threading.Thread.Sleep(160); }
  public static void Esc() { keybd_event(0x1B,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(0x1B,0,2,UIntPtr.Zero); }
}
"@
[RG]::SetProcessDPIAware() | Out-Null
[RG]::Move(2400,300); [RG]::Move(3000,150); [RG]::Move(3136,79)
Start-Sleep -Milliseconds 700
[RG]::Click(3136,79)
Start-Sleep -Milliseconds 2000
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name finA-gear | Out-Null
Copy-Item "D:\输出目录\dsh2\poc\hook\shots\finA-gear-0.png" "$acc\finA-gear-open.png" -Force
Log ("after real gear click helper alive=" + [bool](Get-Process spw-folia-host -ErrorAction SilentlyContinue))
# real click on settings back arrow (panel top-left, physical ~533,352)
[RG]::Click(533,352)
Start-Sleep -Milliseconds 1600
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name finA-back | Out-Null
Copy-Item "D:\输出目录\dsh2\poc\hook\shots\finA-back-0.png" "$acc\finA-gear-back.png" -Force
Log ("after real back click helper alive=" + [bool](Get-Process spw-folia-host -ErrorAction SilentlyContinue))
# ESC closes window (overlay should be closed now)
[RG]::Esc()
Start-Sleep -Milliseconds 1600
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name finA-esc | Out-Null
Copy-Item "D:\输出目录\dsh2\poc\hook\shots\finA-esc-0.png" "$acc\finA-esc.png" -Force
Log ("after ESC helper alive=" + [bool](Get-Process spw-folia-host -ErrorAction SilentlyContinue))
Log "--- log tail ---"
Get-Content (Join-Path $D "spw-folia.log") -Tail 40 | Where-Object { $_ -match "Folia item clicked|spawn exe=|host spawned|host\[info\] geometry|page-viewport|host closed|host-exit|settings update" } | ForEach-Object { Log ("  " + $_) }
Copy-Item (Join-Path $D "spw-folia.log") "$acc\finA-plugin.log" -Force
Copy-Item (Join-Path $D "spw-folia-host.stdout.log") "$acc\finA-host-stdout.log" -Force
