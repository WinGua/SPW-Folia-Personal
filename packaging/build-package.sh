#!/usr/bin/env bash
# Assemble the shippable spw-folia package tree (the payload of the final .spmod).
#
#   packaging/
#     web/                  minimal Folia web subset + settings UI island   -> .spmod/web/
#     native/               spw-folia-host.exe + exe.config + WebView2 dlls  -> .spmod/lib/
#     licenses/             AGPL + WebView2 + audio MIT + NOTICE/SOURCE-OFFER -> .spmod/licenses/
#     SHA256SUMS.txt
#     size-report.json
#     web-stage-report.json
#
# Usage: bash packaging/build-package.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PKG="$ROOT/packaging"
HOST="$ROOT/poc/webview/host/build"
DIST="$ROOT/poc/webview/dist/dist"
FOLIA_LICENSE="$ROOT/work/folia/folia-major-main/LICENSE"
NUPKG="$ROOT/poc/webview/tools/webview2.nupkg"

echo "== spw-folia package assembly =="
echo "root: $ROOT"

# ---------------------------------------------------------------- 1. web payload
echo "-- staging web subset (dependency-report driven, no service worker)"
node "$PKG/tools/stage-web.mjs" --dist "$DIST" --out "$PKG/web"

# ---------------------------------------------------------------- 2. native helper
echo "-- staging native helper"
rm -rf "$PKG/native"
mkdir -p "$PKG/native"
cp "$HOST/spw-folia-host.exe" "$PKG/native/"
cp "$HOST/spw-folia-host.exe.config" "$PKG/native/"
cp "$HOST/Microsoft.Web.WebView2.Core.dll" "$PKG/native/"
cp "$HOST/Microsoft.Web.WebView2.WinForms.dll" "$PKG/native/"
cp "$HOST/WebView2Loader.dll" "$PKG/native/"

# ---------------------------------------------------------------- 3. licenses
echo "-- staging licenses"
rm -rf "$PKG/licenses"
mkdir -p "$PKG/licenses"
cp "$PKG"/licenses-src/*.md "$PKG"/licenses-src/*.txt "$PKG/licenses/"
if [ -f "$FOLIA_LICENSE" ]; then
  cp "$FOLIA_LICENSE" "$PKG/licenses/AGPL-3.0.txt"
else
  echo "WARNING: Folia LICENSE not found at $FOLIA_LICENSE" >&2
fi
if [ -f "$NUPKG" ]; then
  unzip -p "$NUPKG" LICENSE.txt > "$PKG/licenses/WebView2-SDK-LICENSE.txt" 2>/dev/null || true
  unzip -p "$NUPKG" NOTICE.txt > "$PKG/licenses/WebView2-SDK-NOTICE.txt" 2>/dev/null || true
else
  echo "WARNING: WebView2 nupkg not found at $NUPKG (license texts not extracted)" >&2
fi

# ---------------------------------------------------------------- 4. sizes + checksums
echo "-- size report"
node "$PKG/tools/size-report.mjs"

echo "-- checksums"
rm -f "$PKG/SHA256SUMS.txt"
(
  cd "$PKG"
  find web native licenses -type f | sort | while IFS= read -r f; do
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$f"
    else
      # Fallback: PowerShell on systems without coreutils
      powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '$f').Hash.ToLower() + '  $f'"
    fi
  done
) | sed 's/ \*/  /' > "$PKG/SHA256SUMS.txt"

echo
echo "== done =="
echo "package tree: $PKG"
du -sh "$PKG/web" "$PKG/native" "$PKG/licenses" 2>/dev/null || true
