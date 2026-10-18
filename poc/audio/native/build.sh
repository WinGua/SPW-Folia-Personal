#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# MSYS/Git-Bash wrapper around the same csc invocation as build.bat.
set -euo pipefail
# Keep MSYS from rewriting /nologo, /out:... into Windows paths.
export MSYS2_ARG_CONV_EXCL='*'
here="$(cd "$(dirname "$0")" && pwd)"
csc="/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
[ -f "$csc" ] || csc="/c/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe"
[ -f "$csc" ] || { echo "[build] csc.exe not found" >&2; exit 1; }
cd "$here"
"$csc" /nologo /optimize+ /target:exe /out:spw-folia-spectrum.exe \
  AudioInterop.cs SpectrumAnalyzer.cs FoliaAudioMapper.cs SharedAudioRing.cs LoopbackAnalyzer.cs Program.cs
echo "[build] OK: $here/spw-folia-spectrum.exe ($(stat -c%s spw-folia-spectrum.exe) bytes)"
