param(
    [string]$Action = "reveal",
    [int]$X = 0,
    [int]$Y = 0,
    [string]$Name = "v030-t2"
)
# Reveal the player chrome (move the mouse), click a point, or hover the HUD; screenshot each step.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class V30R {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(200); mouse_event(0x0002,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(90); mouse_event(0x0004,0,0,0,UIntPtr.Zero); }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
  public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(90); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
[V30R]::SetProcessDPIAware() | Out-Null
$shot = 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1'
switch ($Action) {
    'reveal' {
        [V30R]::MoveTo(3080, 1830); Start-Sleep -Milliseconds 260
        [V30R]::MoveTo(3090, 1840); Start-Sleep -Milliseconds 600
        & $shot -Name "$Name-reveal" | Out-Null
        Write-Output 'revealed and shot'
    }
    'click' {
        [V30R]::Click($X, $Y); Start-Sleep -Milliseconds 900
        & $shot -Name "$Name-click" | Out-Null
        Write-Output "clicked $X,$Y and shot"
    }
    'click-esc' {
        [V30R]::Click($X, $Y); Start-Sleep -Milliseconds 700
        [V30R]::Key(0x1B); Start-Sleep -Milliseconds 700
        & $shot -Name "$Name-after" | Out-Null
        Write-Output 'clicked, ESC, shot'
    }
    'hover' {
        [V30R]::MoveTo(1600, 1902); Start-Sleep -Milliseconds 300
        [V30R]::MoveTo(1604, 1901); Start-Sleep -Milliseconds 900
        & $shot -Name "$Name-hover" | Out-Null
        Write-Output 'hovered HUD and shot'
    }
    'move' {
        [V30R]::MoveTo($X, $Y); Start-Sleep -Milliseconds 500
        Write-Output "moved $X,$Y"
    }
}
