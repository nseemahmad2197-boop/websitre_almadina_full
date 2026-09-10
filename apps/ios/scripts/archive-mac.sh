#!/bin/bash
# Produces a signed archive only when the owner provides their own Team ID.
# Does not upload, create certificates, or alter provisioning remotely.
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]] || ! command -v xcodebuild >/dev/null 2>&1; then
  echo "BLOCKED: a Mac with Xcode is required. No archive was created."
  exit 2
fi
if [[ ! "${ALMADINA_TEAM_ID:-}" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "Set ALMADINA_TEAM_ID to your Apple Developer Team ID after configuring signing in Xcode."
  exit 2
fi
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
python3 scripts/verify_source.py --release
xcode_version="$(xcodebuild -version | awk '/Xcode/{print $2}')"
if [[ "${xcode_version%%.*}" -lt 26 ]]; then echo "Xcode 26+ is required."; exit 2; fi
archive_path="$project_dir/build/AlmadinaExpress-$(date -u +%Y%m%dT%H%M%SZ).xcarchive"
xcodebuild -project AlmadinaExpress.xcodeproj -scheme AlmadinaExpress -configuration Release -destination 'generic/platform=iOS' -archivePath "$archive_path" "DEVELOPMENT_TEAM=$ALMADINA_TEAM_ID" archive
echo "Archive created at $archive_path. Inspect and validate it in Xcode Organizer before distributing. Nothing was uploaded."
