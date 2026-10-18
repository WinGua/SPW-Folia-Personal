#!/usr/bin/env bash
# Run the deterministic Kotlin test harnesses for the audio/timeline module.
# Usage: ./run-tests.sh [path-to-native-shm-ring]
#
# The native ring file can be produced with:
#   cd native && ./spw-folia-spectrum.exe --seconds 3 --shm ../measure/audio.shm --quiet
set -euo pipefail
cd "$(dirname "$0")"
export MSYS2_ARG_CONV_EXCL='*'

JAVA_BIN="java"
if [ -x "/c/Program Files/Java/jdk-25.0.2/bin/java" ]; then
  JAVA_BIN="/c/Program Files/Java/jdk-25.0.2/bin/java"
fi

./build-kotlin.sh

KS=$(cat out/stdlib.path)
KS_W=$(cygpath -w "$KS")
MAIN_W=$(cygpath -w "$PWD/out/classes")
TEST_W=$(cygpath -w "$PWD/out/test-classes")
CP="$MAIN_W;$TEST_W;$KS_W"

echo
echo "=== PlaybackTimeline tests ==="
"$JAVA_BIN" -cp "$CP" dev.spw.folia.PlaybackTimelineTest

echo
echo "=== SpectrumReader tests ==="
"$JAVA_BIN" -cp "$CP" spwfolia.audio.SpectrumReaderTest "${1:-}"

echo
echo "=== HostPlaybackProbe tests ==="
"$JAVA_BIN" -cp "$CP" spwfolia.probe.HostPlaybackProbeTest

echo
echo "[tests] all suites passed"
