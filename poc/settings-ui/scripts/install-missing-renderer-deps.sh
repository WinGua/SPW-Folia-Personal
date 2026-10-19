#!/usr/bin/env bash
# Iteratively resolve bare imports pulled in by Folia's real renderer graph:
# build -> parse "failed to resolve import \"X\"" -> install X (version from Folia's package.json) -> repeat.
set -u
cd "$(dirname "$0")/../../.." || exit 1   # workspace root
UI="poc/settings-ui"
FOLIA_PKG="work/folia/folia-major-main/package.json"

cd "$UI" || exit 1
for i in $(seq 1 12); do
  OUT=$(npm run build 2>&1 | grep -vE "^    at ")
  if echo "$OUT" | grep -q "✓ built"; then
    echo "BUILD OK after $i iterations"
    echo "$OUT" | grep -E "dist/|✓ built" | tail -3
    exit 0
  fi
  MISSING=$(echo "$OUT" | sed -n 's/.*failed to resolve import "\([^"]*\)" from.*/\1/p' | head -1)
  if [ -z "$MISSING" ]; then
    echo "BUILD FAILED (non-resolve error):"
    echo "$OUT" | grep -A8 "error during build" | head -20
    exit 1
  fi
  echo "[$i] missing: $MISSING"
  PKG="$MISSING"
  # For subpath imports, install the package root.
  case "$PKG" in
    @*/*) PKG=$(echo "$PKG" | awk -F/ '{print $1"/"$2}') ;;
    */*) PKG=$(echo "$PKG" | cut -d/ -f1) ;;
  esac
  VER=$(node -e "try{const p=require('./$FOLIA_PKG');const d={...p.dependencies,...p.devDependencies};const v=d['$PKG']||'';process.stdout.write(v.replace(/^[\\^~>=<v ]+/,'').replace(/[^0-9.].*$/,''))}catch(e){}" 2>/dev/null)
  if [ -n "${VER:-}" ]; then
    echo "  installing $PKG@$VER"
    pnpm add "$PKG@$VER" --save-exact 2>&1 | grep -E "^\+|ERR" | head -2
  else
    echo "  installing $PKG (latest)"
    pnpm add "$PKG" 2>&1 | grep -E "^\+|ERR" | head -2
  fi
done
echo "gave up after 12 iterations"
exit 1
