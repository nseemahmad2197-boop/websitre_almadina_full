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
mkdir -p build/ci-reports
report_dir="$(mktemp -d "$project_dir/build/ci-reports/verify-XXXXXX")"
first_failure=0
while IFS= read -r simulator; do
  [[ -n "$simulator" ]] || continue
  if [[ ! "$simulator" =~ ^[A-Za-z0-9-]+$ ]]; then
    echo "BLOCKED: invalid Simulator identifier."
    exit 2
  fi
  echo "Testing Simulator $simulator; results: $report_dir/$simulator.xcresult"
  if xcodebuild -project AlmadinaExpress.xcodeproj -scheme AlmadinaExpress -configuration Debug -destination "platform=iOS Simulator,id=$simulator" -derivedDataPath build/DerivedData -resultBundlePath "$report_dir/$simulator.xcresult" CODE_SIGNING_ALLOWED=NO test 2>&1 | tee "$report_dir/$simulator.log"; then
    echo "PASS: Simulator $simulator"
  else
    status=$?
    if [[ "$first_failure" -eq 0 ]]; then first_failure="$status"; fi
    echo "FAIL: Simulator $simulator (exit $status). Continuing with the other selected device to collect its result."
  fi
done <<< "$simulators"
if [[ "$first_failure" -ne 0 ]]; then
  # Surface assertion messages near the end of the Actions log, where the
  # default xcodebuild footer otherwise lists only the failed test names.
  python3 - "$report_dir" <<'PY' || echo "Full test logs remain in build/ci-reports."
from pathlib import Path
import sys
root = Path(sys.argv[1])
details = []
for log in sorted(root.glob("*.log")):
    failures = [line for line in log.read_text(errors="replace").splitlines()
                if any(marker in line for marker in ("error:", "XCTAssert", "XCTUnwrap", "failed -"))]
    details.extend(["\n--- " + log.name + " ---", *failures])
(root / "failure-details.txt").write_text("\n".join(details) + "\n", encoding="utf-8")
print("\nFailure details (full logs and xcresult bundles are in build/ci-reports):")
print("\n".join(details[-80:]))
PY
  exit "$first_failure"
fi
echo "Mac verification finished. Physical-device, staging, signing and App Store review checks are still required."
