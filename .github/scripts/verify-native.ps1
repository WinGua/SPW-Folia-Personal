# Verifies that the helper exe references exactly the WebView2 assemblies that ship next to it.
#
# .NET Framework binds referenced assemblies by exact version, so a helper compiled against a
# different WebView2 SDK than the dlls in the package fails at CLR activation with
# FileLoadException 0x80131040 before Main() runs. That is a silent failure for the plugin
# (spawn succeeds, the window never appears), so the build fails here instead.
#
# Must run under Windows PowerShell 5.1 (powershell.exe): ReflectionOnlyLoadFrom is not
# available in PowerShell 7.
param(
    [Parameter(Mandatory = $true)][string]$NativeDir
)

$ErrorActionPreference = 'Stop'
$NativeDir = (Resolve-Path $NativeDir).Path
$exe = Join-Path $NativeDir 'spw-folia-host.exe'
if (!(Test-Path $exe)) { throw "missing helper: $exe" }

$assembly = [System.Reflection.Assembly]::ReflectionOnlyLoadFrom($exe)
$refs = $assembly.GetReferencedAssemblies() | Where-Object { $_.Name -like '*WebView2*' }
if (-not $refs) { throw "helper references no WebView2 assembly; build.sh did not pick up the SDK" }

foreach ($ref in $refs) {
    $dll = Join-Path $NativeDir ($ref.Name + '.dll')
    if (!(Test-Path $dll)) { throw "helper references $($ref.Name) $($ref.Version) but that dll is not shipped" }
    $shipped = [System.Reflection.AssemblyName]::GetAssemblyName($dll).Version
    Write-Host "$($ref.Name): exe=$($ref.Version) shipped=$shipped"
    if ($shipped -ne $ref.Version) {
        throw "$($ref.Name) version mismatch: exe wants $($ref.Version), shipped dll is $shipped. " +
              "Compile the helper against the WebView2 dlls from the base package (base-pkg/native)."
    }
}

Write-Host "native helper assembly references match the shipped dlls"
