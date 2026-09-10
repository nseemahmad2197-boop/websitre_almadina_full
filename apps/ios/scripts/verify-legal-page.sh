#!/bin/bash
# Build this exact project in a new directory, then verify the legal footer
# through both real navigation routes using offline UI fixtures.
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]] || ! command -v xcodebuild >/dev/null 2>&1; then
    echo "macOS and Xcode are required. No iOS build or UI test ran."
    exit 2
fi
project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_dir"
python3 scripts/verify_source.py
simulator_id="${SIMULATOR_ID:-}"
if [[ -z "$simulator_id" ]]; then
    simulator_id="$(xcrun simctl list devices available -j | python3 -c 'import json,sys; data=json.load(sys.stdin); phones=[d for group in data["devices"].values() for d in group if d.get("isAvailable") and "iPhone" in d["name"]]; chosen=next((d for d in phones if d.get("state")=="Booted"), phones[0] if phones else None); print(chosen["udid"] if chosen else "")')"
fi
if [[ -z "$simulator_id" ]]; then
    echo "No available iPhone simulator. Add one in Xcode before this check."
    exit 2
fi
mkdir -p build
result_dir="$(mktemp -d "$project_dir/build/LegalReview.XXXXXX")"
echo "Project: $project_dir/AlmadinaExpress.xcodeproj"
echo "Results: $result_dir"
xcodebuild -project "$project_dir/AlmadinaExpress.xcodeproj" \
    -scheme AlmadinaExpress -configuration Debug \
    -destination "platform=iOS Simulator,id=$simulator_id" \
    -derivedDataPath "$result_dir/DerivedData" \
    -resultBundlePath "$result_dir/LegalPage.xcresult" \
    -only-testing:AlmadinaExpressUITests/AlmadinaExpressUITests/testLegalFooterFromLogin \
    -only-testing:AlmadinaExpressUITests/AlmadinaExpressUITests/testLegalFooterFromSettings \
    CODE_SIGNING_ALLOWED=NO test 2>&1 | tee "$result_dir/xcodebuild.log"
echo "Legal page UI tests passed. Open $result_dir/LegalPage.xcresult in Xcode for screenshots."
