#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APK_PATH="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"

cd "$PROJECT_DIR"
chmod +x gradlew

echo "Stopping old Gradle/Kotlin build processes..."
./gradlew --stop >/dev/null 2>&1 || true

echo "Building the test APK with the Kotlin compiler in-process..."
./gradlew \
  --no-daemon \
  --max-workers=2 \
  -Pkotlin.compiler.execution.strategy=in-process \
  --stacktrace \
  clean \
  :app:assembleDebug

if [[ ! -f "$APK_PATH" ]]; then
  echo "Build finished without finding the expected APK: $APK_PATH" >&2
  exit 1
fi

echo
echo "BUILD SUCCESSFUL"
echo "APK: $APK_PATH"
open "$(dirname "$APK_PATH")" 2>/dev/null || true
