#!/usr/bin/env bash
# Build spw-folia-host.exe with the in-box .NET Framework 4.8 C# compiler (no dotnet SDK needed).
# Output: build/spw-folia-host.exe + the three WebView2 runtime dlls beside it.
set -euo pipefail
cd "$(dirname "$0")"

CSC="${CSC:-/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe}"
SDK="$(cygpath -w "$(cd ../tools/sdk && pwd)")"
OUT="$(cygpath -w "$(mkdir -p build && cd build && pwd)")"
export MSYS2_ARG_CONV_EXCL='*'   # keep csc's -option:value arguments intact

# The demo ObsBrowserSourceConfig is generated from the shared JS source of truth so the host can
# run standalone (no plugin, no driver, synthetic 4-line lyric timeline).
node --input-type=module -e "
import fs from 'node:fs';
import { CONFIG } from '../shared/demoData.mjs';
fs.writeFileSync('DefaultConfig.json', JSON.stringify(CONFIG));
console.log('DefaultConfig.json:', fs.statSync('DefaultConfig.json').size, 'bytes');
"

"$CSC" -nologo -target:exe -platform:x64 -optimize+ \
  -define:LOOPBACK \
  -out:"$OUT\\spw-folia-host.exe" \
  -win32manifest:"$(cygpath -w "$(pwd)/app.manifest")" \
  -resource:"$(cygpath -w "$(pwd)/Shim.js")",Shim.js \
  -resource:"$(cygpath -w "$(pwd)/Overlay.js")",Overlay.js \
  -resource:"$(cygpath -w "$(pwd)/DefaultConfig.json")",DefaultConfig.json \
  -r:System.dll \
  -r:System.Core.dll \
  -r:System.Windows.Forms.dll \
  -r:System.Drawing.dll \
  -r:System.Web.Extensions.dll \
  -r:"$SDK\\Microsoft.Web.WebView2.Core.dll" \
  -r:"$SDK\\Microsoft.Web.WebView2.WinForms.dll" \
  "$(cygpath -w "$(pwd)/Program.cs")" \
  "$(cygpath -w "$(pwd)/DpiSupport.cs")" \
  "$(cygpath -w "$(pwd)/HostForm.cs")" \
  "$(cygpath -w "$(pwd)/AudioProvider.cs")" \
  "$(cygpath -w "$(pwd)/audio/AudioInterop.cs")" \
  "$(cygpath -w "$(pwd)/audio/SpectrumAnalyzer.cs")" \
  "$(cygpath -w "$(pwd)/audio/FoliaAudioMapper.cs")" \
  "$(cygpath -w "$(pwd)/audio/SharedAudioRing.cs")" \
  "$(cygpath -w "$(pwd)/audio/LoopbackAnalyzer.cs")"

# WinForms per-monitor DPI needs the app.config section as well as the manifest; without it the
# framework falls back to 96 dpi for layout while WebView2 still applies the real rasterization scale.
cat > build/spw-folia-host.exe.config <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <startup>
    <supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" />
  </startup>
  <System.Windows.Forms.ApplicationConfigurationSection>
    <add key="DpiAwareness" value="PerMonitorV2" />
    <add key="EnableWindowsFormsHighDpiAutoResizing" value="true" />
  </System.Windows.Forms.ApplicationConfigurationSection>
</configuration>
EOF

cp ../tools/sdk/Microsoft.Web.WebView2.Core.dll build/
cp ../tools/sdk/Microsoft.Web.WebView2.WinForms.dll build/
cp ../tools/sdk/WebView2Loader.dll build/

echo "built:"
ls -la build
