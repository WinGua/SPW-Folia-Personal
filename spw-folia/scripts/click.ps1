param(
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y,
    [string]$Button = "left"
)
# DPI-aware mouse click at absolute screen coordinates (physical pixels).
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class FolMouse {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    public const uint LEFTDOWN = 0x0002;
    public const uint LEFTUP = 0x0004;
    public const uint RIGHTDOWN = 0x0008;
    public const uint RIGHTUP = 0x0010;
}
"@
[FolMouse]::SetProcessDPIAware() | Out-Null
[FolMouse]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 150
$down = if ($Button -eq "right") { [FolMouse]::RIGHTDOWN } else { [FolMouse]::LEFTDOWN }
$up = if ($Button -eq "right") { [FolMouse]::RIGHTUP } else { [FolMouse]::LEFTUP }
[FolMouse]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 90
[FolMouse]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "clicked $X,$Y ($Button)"
