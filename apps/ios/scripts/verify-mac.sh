#!/bin/bash
# Offline-safe: unit tests and local UI fixtures; never authenticates or
# creates data on the live service. Requires a Mac with Xcode 26 or newer.
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]] || ! command -v xcodebuild >/dev/null 2>&1; then
  echo "BLOCKED: macOS and Xcode are required. No iOS compilation or tests ran."
  exit 2
fi
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
xcode_version="$(xcodebuild -version | awk '/Xcode/{print $2}')"
if [[ "${xcode_version%%.*}" -lt 26 ]]; then
  echo "BLOCKED: use Xcode 26+ / iOS 26 SDK+ for current App Store submissions."
  exit 2
fi
python3 scripts/verify_source.py
swift test
mkdir -p build
xcodebuild -project AlmadinaExpress.xcodeproj -scheme AlmadinaExpress -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build
xcodebuild -project AlmadinaExpress.xcodeproj -scheme AlmadinaExpress -configuration Release -destination 'generic/platform=iOS' -derivedDataPath build/DeviceData CODE_SIGNING_ALLOWED=NO build

# Install Simulator runtimes in Xcode first. An explicit SIMULATOR_ID can select
# a device; otherwise choose one available iPhone and one available iPad.
simulators="${SIMULATOR_ID:-}"
if [[ -z "$simulators" ]]; then
  simulators="$(xcrun simctl list devices available -j | python3 -c 'import sys,json; d=json.load(sys.stdin); all_devices=[x for rows in d["devices"].values() for x in rows if x.get("isAvailable")]; chosen=[next((x["udid"] for x in all_devices if word in x["name"]), "") for word in ["iPhone", "iPad"]]; print("\n".join(x for x in chosen if x))')"
fi
if [[ -z "$simulators" ]]; then
  echo "BLOCKED: builds completed, but no Simulator is available for UI tests. Install iPhone/iPad runtimes in Xcode."
  exit 2
fi
while IFS= read -r simulator; do
  [[ -n "$simulator" ]] || continue
  xcodebuild -project AlmadinaExpress.xcodeproj -scheme AlmadinaExpress -configuration Debug -destination "platform=iOS Simulator,id=$simulator" -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO test
done <<< "$simulators"
echo "Mac verification finished. Physical-device, staging, signing and App Store review checks are still required."
