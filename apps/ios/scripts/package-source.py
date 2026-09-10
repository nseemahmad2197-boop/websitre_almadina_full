#!/usr/bin/env python3
"""Package only the listed source files with fresh ZIP dates and a versioned folder.

Do not reuse ZipInfo records from earlier releases: their dates can survive
content changes and interfere with an existing incremental build workflow.
Usage: python3 scripts/package-source.py [--output /path/to/source.zip]
"""
import argparse
import datetime
import hashlib
from pathlib import Path
import re
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILES = ['.gitignore',
 'AlmadinaExpress.xcodeproj/project.pbxproj',
 'AlmadinaExpress.xcodeproj/xcshareddata/xcschemes/AlmadinaExpress-Device.xcscheme',
 'AlmadinaExpress.xcodeproj/xcshareddata/xcschemes/AlmadinaExpress.xcscheme',
 'App/AlmadinaApp.swift',
 'App/Networking/APIClient.swift',
 'App/Resources/Assets.xcassets/AccentColor.colorset/Contents.json',
 'App/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
 'App/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json',
 'App/Resources/Assets.xcassets/BrandMark.imageset/BrandMark.png',
 'App/Resources/Assets.xcassets/BrandMark.imageset/Contents.json',
 'App/Resources/Assets.xcassets/Contents.json',
 'App/Resources/Assets.xcassets/LaunchBackground.colorset/Contents.json',
 'App/Resources/Info.plist',
 'App/Resources/PrivacyInfo.xcprivacy',
 'App/Security/KeychainStore.swift',
 'App/Services/LocationPicker.swift',
 'App/Services/Notifications.swift',
 'App/Services/PrintDocuments.swift',
 'App/Services/QRCode.swift',
 'App/State/AccountActions.swift',
 'App/State/AppStore.swift',
 'App/Views/AdminViews.swift',
 'App/Views/ApplicationView.swift',
 'App/Views/AuthViews.swift',
 'App/Views/CollectionViews.swift',
 'App/Views/Components.swift',
 'App/Views/DashboardView.swift',
 'App/Views/ImportView.swift',
 'App/Views/InformationViews.swift',
 'App/Views/LocalityPicker.swift',
 'App/Views/OrderViews.swift',
 'App/Views/RecipientsView.swift',
 'App/Views/SettingsViews.swift',
 'AppStore/API-CONTRACT.md',
 'AppStore/DEVICE-TESTS-AR.md',
 'AppStore/RELEASE-CHECKLIST-AR.md',
 'AppStore/VERIFICATION-AR.md',
 'AssetsSource/AppIcon.svg',
 'Package.swift',
 'README-AR.md',
 'SECURITY-REVIEW-AR.md',
 'Sources/AlmadinaCore/BusinessRules.swift',
 'Sources/AlmadinaCore/CSV.swift',
 'Sources/AlmadinaCore/DeliveryLocations.generated.swift',
 'Sources/AlmadinaCore/DeliveryLocations.swift',
 'Sources/AlmadinaCore/Models.swift',
 'Tests/AlmadinaCoreTests/AlmadinaCoreTests.swift',
 'UITests/AlmadinaExpressUITests.swift',
 'UPDATE-AR.md',
 'scripts/apply-update.py',
 'scripts/archive-mac.sh',
 'scripts/generate_project.py',
 'scripts/import_locations.py',
 'scripts/verify-mac.sh',
 'scripts/verify_source.py',
 'APPLY-UPDATE-MAC.command',
 'scripts/verify-legal-page.sh',
 'scripts/package-source.py']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    pbx = (ROOT / "AlmadinaExpress.xcodeproj/project.pbxproj").read_text()
    versions = set(re.findall(r'"?MARKETING_VERSION"?\s*=\s*"?(\d+(?:\.\d+){1,2})"?\s*;', pbx))
    if len(versions) != 1:
        parser.error("Expected one consistent app version in the Xcode project.")
    version = versions.pop()
    output = (args.output or ROOT.parent / f"Almadina-Express-iOS-v{version}-source.zip").expanduser().resolve()
    prefix = f"Almadina-Express-iOS-{version}"
    # DOS ZIP dates are local wall time, as used by ZipInfo.from_file.
    stamp = datetime.datetime.now().timetuple()[:6]
    for relative in SOURCE_FILES:
        path = ROOT / relative
        if not path.is_file() or path.resolve() != path:
            parser.error("Missing or symlinked source file: " + relative)
        if path == output:
            parser.error("Output must not overwrite a source file.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in SOURCE_FILES:
            path = ROOT / relative
            entry = zipfile.ZipInfo(prefix + "/" + relative, date_time=stamp)
            entry.create_system = 3
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (stat.S_IFREG | stat.S_IMODE(path.stat().st_mode)) << 16
            archive.writestr(entry, path.read_bytes())
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Source ZIP integrity verification failed.")
    print(output)
    print(f"{len(SOURCE_FILES)} source files; folder: {prefix}")
    print("SHA256: " + hashlib.sha256(output.read_bytes()).hexdigest())

if __name__ == "__main__":
    main()
