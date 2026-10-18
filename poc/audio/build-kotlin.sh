#!/usr/bin/env bash
# Build the Kotlin side of spw-folia's audio/timeline support module without a Gradle project.
#
# Kotlin compiler is taken from the local Gradle cache (kotlin-compiler-embeddable), so no
# download and no kotlinc install is required. Output:
#   poc/audio/out/classes       - main classes (FoliaAudioState, SpectrumReader, PlaybackTimeline, ...)
#   poc/audio/out/test-classes  - deterministic test harnesses (main() based)
#   poc/audio/out/stdlib.path   - classpath of the kotlin-stdlib used, for run-tests.sh
set -euo pipefail
cd "$(dirname "$0")"
export MSYS2_ARG_CONV_EXCL='*'

JAVA_BIN="java"
if [ -x "/c/Program Files/Java/jdk-25.0.2/bin/java" ]; then
  JAVA_BIN="/c/Program Files/Java/jdk-25.0.2/bin/java"
fi

GLOBS="$HOME/.gradle/caches/modules-2/files-2.1/org.jetbrains.kotlin"
KC=$(ls "$GLOBS"/kotlin-compiler-embeddable/*/*/kotlin-compiler-embeddable-*.jar 2>/dev/null | sort -V | tail -1)
KS=$(ls "$GLOBS"/kotlin-stdlib/*/*/kotlin-stdlib-*.jar 2>/dev/null | grep -v sources | sort -V | tail -1)
# The embeddable compiler still needs kotlinx-coroutines at compile time (2.4.x); Gradle's cache
# normally has it because the Kotlin Gradle plugin depends on it.
KCC=$(ls "$HOME"/.gradle/caches/modules-2/files-2.1/org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/*/*/kotlinx-coroutines-core-jvm-*.jar 2>/dev/null | grep -v sources | sort -V | tail -1)
# The compiler also generates org.jetbrains.annotations.Nullable/NotNull annotations at codegen.
KA=$(ls "$HOME"/.gradle/caches/modules-2/files-2.1/org.jetbrains/annotations/*/*/annotations-*.jar 2>/dev/null | grep -v sources | sort -V | tail -1)
if [ -z "$KC" ] || [ -z "$KS" ]; then
  echo "[kotlin] ERROR: kotlin-compiler-embeddable / kotlin-stdlib not found under $GLOBS" >&2
  echo "[kotlin] install kotlinc or populate the Gradle cache first" >&2
  exit 1
fi
if [ -z "$KCC" ]; then
  echo "[kotlin] WARN: kotlinx-coroutines-core-jvm not found in Gradle cache; trying compiler only" >&2
fi
if [ -z "$KA" ]; then
  echo "[kotlin] WARN: org.jetbrains:annotations not found in Gradle cache; trying compiler only" >&2
fi

KC_W=$(cygpath -w "$KC")
KS_W=$(cygpath -w "$KS")
KCC_W=""
if [ -n "$KCC" ]; then KCC_W=";$(cygpath -w "$KCC")"; fi
KA_W=""
if [ -n "$KA" ]; then KA_W=";$(cygpath -w "$KA")"; fi
COMPILER_CP="$KC_W;$KS_W$KCC_W$KA_W"
OUT_W=$(cygpath -w "$PWD/out/classes")
TEST_W=$(cygpath -w "$PWD/out/test-classes")

rm -rf out/classes out/test-classes
mkdir -p out/classes out/test-classes

echo "[kotlin] java     = $JAVA_BIN"
echo "[kotlin] compiler = $KC"
echo "[kotlin] stdlib   = $KS"

"$JAVA_BIN" -cp "$COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -classpath "$KS_W" -d "$OUT_W" \
  $(find src kotlin -name '*.kt' | sort)
echo "[kotlin] main classes OK -> out/classes"

"$JAVA_BIN" -cp "$COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -classpath "$KS_W;$OUT_W" -d "$TEST_W" \
  $(find tests -name '*.kt' | sort)
echo "[kotlin] test classes OK -> out/test-classes"

echo "$KS" > out/stdlib.path
echo "[kotlin] done"
