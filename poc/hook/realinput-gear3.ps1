param([string]$Name = "t13e")
$ErrorActionPreference = "Continue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class G4 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; public int p1; public int p2; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr e);
  public static void MoveAbs(int x, int y) {
    var inp = new INPUT[1];
    inp[0].type = 0; inp[0].mi.dx = (int)Math.Round(x * 65535.0 / 3199.0); inp[0].mi.dy = (int)Math.Round(y * 65535.0 / 1999.0); inp[0].mi.dwFlags = 0x0001 | 0x8000;
    SendInput(1, inp, Marshal.SizeOf(typeof(INPUT))); System.Threading.Thread.Sleep(140);
  }
  public static void ClickAbs(int x, int y) {
    MoveAbs(x, y); System.Threading.Thread.Sleep(260);
    var inp = new INPUT[2];
    inp[0].type = 0; inp[0].mi.dwFlags = 0x0002; inp[1].type = 0; inp[1].mi.dwFlags = 0x0004;
    SendInput(2, inp, Marshal.SizeOf(typeof(INPUT))); System.Threading.Thread.Sleep(160);
  }
  public static void Esc() { keybd_event(0x1B,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(0x1B,0,2,UIntPtr.Zero); }
}
"@
[G4]::SetProcessDPIAware() | Out-Null
function Shot([string]$n) {
  & 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name $n | Out-Null
  $src = "D:\输出目录\dsh2\poc\hook\shots\$n-0.png"
  if (Test-Path $src) { Copy-Item $src "D:\输出目录\dsh2\poc\hook\acceptance\$n.png" -Force }
  Write-Output "shot $n"
}
function HelperAlive { [bool](Get-Process spw-folia-host -ErrorAction SilentlyContinue) }

# Real mouse: hover gear then click it
[G4]::MoveAbs(2400,300); [G4]::MoveAbs(3000,150); [G4]::MoveAbs(3136,79)
Start-Sleep -Milliseconds 600
[G4]::ClickAbs(3136,79)
Start-Sleep -Milliseconds 1800
Shot "$Name-gear2"
Write-Output ("after real gear click helper alive=" + (HelperAlive))
# Real click on settings back arrow (panel top-left at physical ~533,352)
[G4]::ClickAbs(533,352)
Start-Sleep -Milliseconds 1500
Shot "$Name-back2"
Write-Output ("after real back click helper alive=" + (HelperAlive))
# ESC: overlay-first semantics then window close
[G4]::Esc(); Start-Sleep -Milliseconds 1300
Shot "$Name-esc1"
Write-Output ("after ESC1 helper alive=" + (HelperAlive))
if (HelperAlive) { [G4]::Esc(); Start-Sleep -Milliseconds 1600; Shot "$Name-esc2"; Write-Output ("after ESC2 helper alive=" + (HelperAlive)) }
