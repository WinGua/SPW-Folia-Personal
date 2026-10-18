@echo off
rem SPDX-License-Identifier: MIT
rem Build spw-folia-spectrum.exe with the .NET Framework C# compiler shipped with Windows.
rem No NuGet packages, no external dependencies, no MSBuild needed.
setlocal
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [build] csc.exe not found under %WINDIR%\Microsoft.NET 1>&2
  exit /b 1
)
pushd "%~dp0"
"%CSC%" /nologo /optimize+ /target:exe /out:spw-folia-spectrum.exe ^
  AudioInterop.cs SpectrumAnalyzer.cs FoliaAudioMapper.cs SharedAudioRing.cs LoopbackAnalyzer.cs Program.cs
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" (
  echo [build] OK:%~dp0spw-folia-spectrum.exe
) else (
  echo [build] FAILED rc=%RC% 1>&2
)
popd
exit /b %RC%
