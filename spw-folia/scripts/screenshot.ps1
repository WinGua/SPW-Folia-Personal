param(
    [string]$OutDir = "D:\输出目录\dsh2\poc\hook\shots",
    [string]$Name = "screen"
)
# Capture every monitor into <OutDir>\<Name>-<i>.png and print path + bounds.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class FolScreenshotDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[FolScreenshotDpi]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$i = 0
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    $b = $s.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $path = Join-Path $OutDir ("{0}-{1}.png" -f $Name, $i)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output ("{0} bounds={1},{2} {3}x{4} primary={5}" -f $path, $b.X, $b.Y, $b.Width, $b.Height, $s.Primary)
    $i++
}
