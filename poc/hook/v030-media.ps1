param([string]$Name = "v030-play", [int]$Vk = 0xB3)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class V30P {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
[V30P]::keybd_event([byte]$Vk, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
[V30P]::keybd_event([byte]$Vk, 0, 2, [UIntPtr]::Zero)
Write-Output "sent vk=0x$($Vk.ToString('X2'))"
& 'D:\输出目录\dsh2\spw-folia\scripts\screenshot.ps1' -Name $Name | Out-Null
Write-Output "shot $Name"
