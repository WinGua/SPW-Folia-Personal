param([string]$Name = "t13-gear")
$ErrorActionPreference = "Continue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RI {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; public int pad1; public int pad2; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static void MoveTo(int x, int y) {
    // absolute move in 0..65535 virtual-screen coordinates
    int vx = (int)Math.Round(x * 65535.0 / 3199.0);
    int vy = (int)Math.Round(y * 65535.0 / 1999.0);
    var inp = new INPUT[1];
    inp[0].type = 0;
    inp[0].mi.dx = vx; inp[0].mi.dy = vy;
    inp[0].mi.dwFlags = 0x0001 | 0x8000; // MOVE | ABSOLUTE
    SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(120);
  }
  public static void ClickAt(int x, int y) {
    MoveTo(x, y);
    System.Threading.Thread.Sleep(180);
    var inp = new INPUT[2];
    inp[0].type = 0; inp[0].mi.dwFlags = 0x0002; // LEFTDOWN
    inp[1].type = 0; inp[1].mi.dwFlags = 0x0004; // LEFTUP
    SendInput(2, inp, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(120);
  }
  public static void Esc() { keybd_event(0x1B,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(0x1B,0,2,UIntPtr.Zero); }
}
"@
[RI]::SetProcessDPIAware() | Out-Null

function Shot([string]$n) {
  & 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name $n | Out-Null
  $src = "D:\输出目录\dsh2\poc\hook\shots\$n-0.png"
  if (Test-Path $src) { Copy-Item $src "D:\输出目录\dsh2\poc\hook\acceptance\$n.png" -Force }
  Write-Output "shot $n"
}
function HelperAlive { [bool](Get-Process spw-folia-host -ErrorAction SilentlyContinue) }

Write-Output ("helper alive at start=" + (HelperAlive))
# 1) real mouse move + click on the in-page gear (top-right, physical 3121,79)
[RI]::MoveTo(3000, 120)            # generate real mouse move first (hover)
[RI]::MoveTo(3121, 79)
Start-Sleep -Milliseconds 400
[RI]::ClickAt(3121, 79)
Start-Sleep -Milliseconds 2000
Shot "$Name-open"
Write-Output ("after real gear click helper alive=" + (HelperAlive))
# 2) real click on settings back arrow (panel top-left, physical ~533,352)
[RI]::ClickAt(533, 352)
Start-Sleep -Milliseconds 1500
Shot "$Name-back"
Write-Output ("after real back click helper alive=" + (HelperAlive))
# 3) ESC semantics
[RI]::Esc(); Start-Sleep -Milliseconds 1200
Shot "$Name-esc1"
Write-Output ("after ESC1 helper alive=" + (HelperAlive))
if (HelperAlive) { [RI]::Esc(); Start-Sleep -Milliseconds 1600; Shot "$Name-esc2" ; Write-Output ("after ESC2 helper alive=" + (HelperAlive)) }
