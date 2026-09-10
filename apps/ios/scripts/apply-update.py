#!/usr/bin/env python3
"""Apply this package to the selected Xcode project, with backup and verification.

Only version/build values are changed in project.pbxproj. Signing, bundle ID,
Info.plist, AppIcon and entitlements are preserved. Close Xcode before updating.
Usage: python3 scripts/apply-update.py /path/to/existing/almadina-ios [--dry-run]
"""
import argparse
import datetime
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

VERSION = "1.0.12"
BUILD = 13
PROJECT = "AlmadinaExpress.xcodeproj/project.pbxproj"
BRAND = "App/Resources/Assets.xcassets/BrandMark.imageset/BrandMark.png"
FILES = [
    "App/AlmadinaApp.swift", "App/Services/Notifications.swift", "App/Services/QRCode.swift",
    "App/Networking/APIClient.swift", "App/Services/LocationPicker.swift",
    "App/Security/KeychainStore.swift", "App/Resources/PrivacyInfo.xcprivacy",
    "App/State/AppStore.swift", "App/State/AccountActions.swift", "App/Views/Components.swift",
    "App/Resources/Assets.xcassets/BrandMark.imageset/Contents.json", BRAND,
    "App/Views/CollectionViews.swift", "App/Views/DashboardView.swift",
    "App/Views/ApplicationView.swift", "App/Views/SettingsViews.swift", "App/Views/InformationViews.swift",
    "App/Views/OrderViews.swift", "App/Views/AuthViews.swift", "App/Views/AdminViews.swift",
    "UITests/AlmadinaExpressUITests.swift",
    "scripts/verify-mac.sh", "scripts/verify-legal-page.sh", "scripts/verify_source.py", "scripts/apply-update.py",
    "scripts/generate_project.py", "scripts/package-source.py", "APPLY-UPDATE-MAC.command",
    "UPDATE-AR.md", "README-AR.md", "SECURITY-REVIEW-AR.md", "AppStore/VERIFICATION-AR.md", "AppStore/API-CONTRACT.md",
    "AppStore/RELEASE-CHECKLIST-AR.md", "AppStore/DEVICE-TESTS-AR.md",
    "Sources/AlmadinaCore/BusinessRules.swift", "Sources/AlmadinaCore/Models.swift",
    "Tests/AlmadinaCoreTests/AlmadinaCoreTests.swift",
]
SCHEME = "AlmadinaExpress.xcodeproj/xcshareddata/xcschemes/AlmadinaExpress-Device.xcscheme"


def checked_path(root, relative):
    path = root / relative
    # Reject aliases, even inside the project, to keep backups unambiguous.
    if path.resolve() != path:
        raise ValueError("A project path uses a symlink: " + relative)
    if path.exists() and not path.is_file():
        raise ValueError("Expected a file: " + relative)
    return path


def setting_pattern(key):
    return re.compile(r'(?m)^(\s*"?' + key + r'"?\s*=\s*)("[^"\n]*"|[^;\n]+)(\s*;)')


def revised_project(text):
    versions = [m.group(2).strip().strip('"') for m in setting_pattern("MARKETING_VERSION").finditer(text)]
    builds = [m.group(2).strip().strip('"') for m in setting_pattern("CURRENT_PROJECT_VERSION").finditer(text)]
    if not versions or not builds or not all(re.fullmatch(r"\d+(?:\.\d+){0,2}", v) for v in versions) or not all(b.isdigit() for b in builds):
        raise ValueError("Version/build must be explicit numeric values in project.pbxproj before this update.")
    def version_key(value):
        parts = tuple(map(int, value.split(".")))
        return parts + (0,) * (3 - len(parts))
    version = max([VERSION] + versions, key=version_key)
    build = str(max(BUILD, max(map(int, builds)) + 1))
    for key, value in (("MARKETING_VERSION", version), ("CURRENT_PROJECT_VERSION", build)):
        text = setting_pattern(key).sub(lambda m: m.group(1) + '"' + value + '"' + m.group(3), text)
    return text, version, build


def verify(target):
    result = subprocess.run([sys.executable, str(target / "scripts/verify_source.py")],
                            cwd=target, capture_output=True, text=True)
    if result.returncode:
        raise ValueError("Static project verification failed:\n" + result.stdout + result.stderr)
    print(next((line for line in result.stdout.splitlines() if line.startswith("SUMMARY:")), result.stdout))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1]
    target = args.project.expanduser().resolve()
    if target.suffix == ".xcodeproj": target = target.parent
    backup = None
    originals = set()
    files = []
    writes_started = False
    try:
        project_path = checked_path(target, PROJECT)
        if not project_path.is_file():
            raise ValueError("Select the directory containing AlmadinaExpress.xcodeproj.")
        print("Selected Xcode project: " + str(project_path.parent))
        if source == target:
            verify(target)
            print("This is the new source package. Open this project, select your signing team, and Run on your iPhone.")
            return 0
        project_text = project_path.read_text()
        new_project, version, build = revised_project(project_text)
        info = plistlib.loads(checked_path(target, "App/Resources/Info.plist").read_bytes())
        if info.get("CFBundleShortVersionString") != "$(MARKETING_VERSION)" or info.get("CFBundleVersion") != "$(CURRENT_PROJECT_VERSION)":
            raise ValueError("Info.plist has fixed version values. Use $(MARKETING_VERSION) and $(CURRENT_PROJECT_VERSION) for the app version/build first.")
        files = list(FILES)
        scheme_target = ET.parse(source / SCHEME).find(".//BuildableReference").get("BlueprintIdentifier")
        if scheme_target in project_text:
            files.append(SCHEME)
        else:
            print("Different Xcode target: your existing scheme will be preserved.")
        for relative in files:
            if not checked_path(source, relative).is_file():
                raise ValueError("Update file missing: " + relative)
            checked_path(target, relative)
        icon = checked_path(target, "App/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png")
        existing_icon = icon.read_bytes() if icon.is_file() else None
        print(f"Version {version} / Build {build}. Close Xcode before applying.")
        if args.dry_run:
            print(f"Preview only: {len(files)} update files and version/build settings. No files changed.")
            return 0
        backup = target / ("update-backup-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
        backup.mkdir()
        for relative in files + [PROJECT]:
            original = target / relative
            if original.is_file():
                saved = backup / relative
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, saved)
                originals.add(relative)
        writes_started = True
        for relative in files:
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            # An extracted update may retain an old ZIP timestamp. The file's
            # content is new to this project, so mark it as changed for Xcode.
            # copy2 is intentionally only used for backups and restoration.
            shutil.copy(source / relative, destination)
            os.utime(destination, None)
        if existing_icon is not None:
            (target / BRAND).write_bytes(existing_icon)
        project_path.write_text(new_project)
        for relative in files:
            expected = existing_icon if relative == BRAND and existing_icon is not None else (source / relative).read_bytes()
            if (target / relative).read_bytes() != expected:
                raise ValueError("Copied file did not match: " + relative)
        if project_path.read_text() != new_project:
            raise ValueError("Version/build settings were not saved.")
        verify(target)
        print("Updated and checked. Signing, bundle ID, Info.plist and AppIcon preserved.")
        print("Backup: " + str(backup))
        print(f"Run this project on your iPhone, then check Settings: Version {version}, Build {build}.")
        print("Before the first Run after this update: Product > Clean Build Folder in Xcode.")
        print("Static checks are not an Xcode build or an iPhone test.")
        return 0
    except (OSError, ValueError, ET.ParseError) as error:
        print("Update failed: " + str(error), file=sys.stderr)
        if writes_started:
            try:
                for relative in files + [PROJECT]:
                    destination = target / relative
                    if relative in originals:
                        shutil.copy2(backup / relative, destination)
                    else:
                        destination.unlink(missing_ok=True)
                print("Original files restored. Backup: " + str(backup), file=sys.stderr)
            except OSError as restore_error:
                print("Restore incomplete: " + str(restore_error) + "\nOriginal files are in: " + str(backup), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
