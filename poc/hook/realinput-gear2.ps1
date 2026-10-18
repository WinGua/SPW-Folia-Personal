param([string]$Name = "t13d-gear")
$ErrorActionPreference = "Continue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class G2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; public int p1; public int p2; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static void MoveAbs(int x, int y) {
    int vx = (int)Math.Round(x * 65535.0 / 3199.0);
    int vy = (int)Math.Round(y * 65535.0 / 1999.0);
    var inp = new INPUT[1];
    inp[0].type = 0; inp[0].mi.dx = vx; inp[0].mi.dy = vy; inp[0].mi.dwFlags = 0x0001 | 0x8000;
    SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(140);
  }
  public static void ClickAbs(int x, int y) {
    MoveAbs(x, y);
    System.Threading.Thread.Sleep(220);
    var inp = new INPUT[2];
    inp[0].type = 0; inp[0].mi.dwFlags = 0x0002;
    inp[1].type = 0; inp[1].mi.dwFlags = 0x0004;
    SendInput(2, inp, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(140);
  }
  public static void Esc() { keybd_event(0x1B,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(0x1B,0,2,UIntPtr.Zero); }
}
"@
[G2]::SetProcessDPIAware() | Out-Null
function Shot([string]$n) {
  & 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name $n | Out-Null
  $src = "D:\输出目录\dsh2\poc\hook\shots\$n-0.png"
  if (Test-Path $src) { Copy-Item $src "D:\输出目录\dsh2\poc\hook\acceptance\$n.png" -Force }
  Write-Output "shot $n"
}
function HelperAlive { [bool](Get-Process spw-folia-host -ErrorAction SilentlyContinue) }

# helper should currently have the overlay open from the F1 probe -> close only the overlay
[G2]::Esc(); Start-Sleep -Milliseconds 1300
Write-Output ("after ESC (close F1 overlay) helper alive=" + (HelperAlive))
# sweep real mouse moves to reveal chrome, then hover over gear
[G2]::MoveAbs(1200, 500); [G2]::MoveAbs(2000, 300); [G2]::MoveAbs(2600, 160); [G2]::MoveAbs(3050, 110); [G2]::MoveAbs(3136, 79)
Start-Sleep -Milliseconds 700
Shot "$Name-hover"
# real click on gear (physical centre measured from page screenshot: ~3136,79)
[G2]::ClickAbs(3136, 79)
Start-Sleep -Milliseconds 1800
Shot "$Name-open"
Write-Output ("after real gear click helper alive=" + (HelperAlive))
# close overlay via real ESC, then window via real ESC
[G2]::Esc(); Start-Sleep -Milliseconds 1200
Shot "$Name-esc1"
Write-Output ("after ESC1 helper alive=" + (HelperAlive))
if (HelperAlive) { [G2]::Esc(); Start-Sleep -Milliseconds 1500; Shot "$Name-esc2"; Write-Output ("after ESC2 helper alive=" + (HelperAlive)) }
