#!/usr/bin/env python3
"""Dependency-free static packaging checks, NOT a Swift compiler or UI test.

--release also enforces owner-supplied public privacy/support settings. It still
cannot establish App Store compliance, successful signing, or functional QA.
"""
import argparse
import json
import pathlib
import plistlib
import re
import struct
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--release", action="store_true")
args = parser.parse_args()
checks = []

def check(name, condition):
    checks.append((name, bool(condition)))
    print(("PASS " if condition else "FAIL ") + name)

def read(path):
    return (ROOT / path).read_text()

# Parse the OpenStep property-list subset used by the deterministic generator.
# This catches missing delimiters, duplicate IDs/keys and dangling references;
# Xcode must still validate all native build-setting semantics on a Mac.
def parse_pbx(source):
    token = re.compile(r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|[{}()=;,]|[^\s{}()=;,]+', re.S)
    tokens = [m.group() for m in token.finditer(source) if not m.group().startswith(("//", "/*"))]
    i = 0
    def expect(value):
        nonlocal i
        if i >= len(tokens) or tokens[i] != value:
            raise ValueError("Expected " + value)
        i += 1
    def value():
        nonlocal i
        current = tokens[i]; i += 1
        if current == "{":
            output = {}
            while tokens[i] != "}":
                key = value()
                if key in output: raise ValueError("Duplicate key " + key)
                expect("="); output[key] = value(); expect(";")
            expect("}"); return output
        if current == "(":
            output = []
            while tokens[i] != ")":
                output.append(value())
                if tokens[i] == ",": expect(",")
                elif tokens[i] != ")": raise ValueError("Missing array comma")
            expect(")"); return output
        return json.loads(current) if current.startswith('"') else current
    result = value()
    if i != len(tokens): raise ValueError("Trailing project tokens")
    return result

def swift_delimiters(source):
    """Check nested (), [] and {} while respecting comments and interpolation.

    Deliberately only structural: this is NOT Swift syntax/type validation.
    """
    index = 0
    def string():
        nonlocal index
        quote = '"""' if source.startswith('"""', index) else '"'
        index += len(quote)
        while index < len(source):
            if source.startswith(quote, index): index += len(quote); return
            if source[index] == "\\":
                index += 1
                if index < len(source) and source[index] == "(": index += 1; scope(")")
                else: index += 1
            else: index += 1
        raise ValueError("Unclosed string")
    def scope(closing=None):
        nonlocal index
        pairs = {"(": ")", "[": "]", "{": "}"}
        while index < len(source):
            if source.startswith("//", index):
                end = source.find("\n", index)
                index = len(source) if end < 0 else end + 1
            elif source.startswith("/*", index):
                index += 2; depth = 1
                while index < len(source) and depth:
                    if source.startswith("/*", index): depth += 1; index += 2
                    elif source.startswith("*/", index): depth -= 1; index += 2
                    else: index += 1
                if depth: raise ValueError("Unclosed comment")
            elif source[index] == '"': string()
            elif source[index] in pairs:
                expected = pairs[source[index]]; index += 1; scope(expected)
            elif source[index] in ")]}":
                if source[index] != closing:
                    raise ValueError("Unexpected delimiter at line " + str(source[:index].count("\n") + 1))
                index += 1; return
            else: index += 1
        if closing: raise ValueError("Missing " + closing)
    scope()

info = plistlib.loads((ROOT / "App/Resources/Info.plist").read_bytes())
privacy = plistlib.loads((ROOT / "App/Resources/PrivacyInfo.xcprivacy").read_bytes())
check("Info.plist and PrivacyInfo.xcprivacy are valid property lists", True)
api_url = urlparse(info["AlmadinaAPIBaseURL"])
check("API uses HTTPS and Almadina route layout (production or staging)", api_url.scheme == "https" and api_url.hostname and api_url.path.endswith("/api/almadina/") and not api_url.username and not api_url.password and not api_url.query and not api_url.fragment)
check("No ATS HTTP exceptions", not info.get("NSAppTransportSecurity"))
check("Permission descriptions explain camera, Face ID, and optional location", all(len(info.get(key, "")) > 35 for key in ["NSCameraUsageDescription", "NSFaceIDUsageDescription", "NSLocationWhenInUseUsageDescription"]))
check("No microphone or background location permission", "NSMicrophoneUsageDescription" not in info and "location" not in info.get("UIBackgroundModes", []))
check("Phone supports portrait and landscape", len(info["UISupportedInterfaceOrientations"]) == 3)
check("iPad supports all orientations and non-full-screen layout", len(info["UISupportedInterfaceOrientations~ipad"]) == 4 and info["UIRequiresFullScreen"] is False)
check("Background task identifier matches app bundle", info["BGTaskSchedulerPermittedIdentifiers"] == ["$(PRODUCT_BUNDLE_IDENTIFIER).refresh"])
check("No advertising tracking declaration", privacy["NSPrivacyTracking"] is False and privacy["NSPrivacyTrackingDomains"] == [])
check("UserDefaults accessed-API reason is declared", privacy["NSPrivacyAccessedAPITypes"] == [{"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]}])
check("Data declarations specify linkage, purposes and no tracking", all(isinstance(item.get("NSPrivacyCollectedDataTypeLinked"), bool) and item.get("NSPrivacyCollectedDataTypeTracking") is False and item.get("NSPrivacyCollectedDataTypePurposes") for item in privacy["NSPrivacyCollectedDataTypes"]))

project = parse_pbx(read("AlmadinaExpress.xcodeproj/project.pbxproj"))
objects = project["objects"]
check("Xcode project parses and has a valid root", objects[project["rootObject"]]["isa"] == "PBXProject")
targets = [o for o in objects.values() if o["isa"] == "PBXNativeTarget"]
check("Real native app target plus UI test target", sorted(t["productType"] for t in targets) == ["com.apple.product-type.application", "com.apple.product-type.bundle.ui-testing"])
refs = [o for o in objects.values() if o["isa"] == "PBXFileReference" and o.get("sourceTree") == "SOURCE_ROOT"]
check("Every project source/resource reference exists and stays inside project", all((ROOT / r["path"]).resolve().is_relative_to(ROOT) and (ROOT / r["path"]).exists() for r in refs))
check("Every build-file reference resolves", all(o["fileRef"] in objects for o in objects.values() if o["isa"] == "PBXBuildFile"))
sources = sorted(list(ROOT.glob("App/**/*.swift")) + list(ROOT.glob("Sources/AlmadinaCore/*.swift")))
referenced_sources = {r["path"] for r in refs if r.get("lastKnownFileType") == "sourcecode.swift" and not r["path"].startswith("UITests/")}
check("Every app/core Swift source is included exactly once", referenced_sources == {p.relative_to(ROOT).as_posix() for p in sources} and len(referenced_sources) == len([r for r in refs if r.get("lastKnownFileType") == "sourcecode.swift" and not r["path"].startswith("UITests/")]))
app_targets = [t for t in targets if t["productType"] == "com.apple.product-type.application"]
compiled_sources = []
for target in app_targets:
    for phase_id in target.get("buildPhases", []):
        phase = objects.get(phase_id, {})
        if phase.get("isa") != "PBXSourcesBuildPhase": continue
        for build_id in phase.get("files", []):
            ref = objects.get(objects.get(build_id, {}).get("fileRef"), {})
            compiled_sources.append(ref.get("path") if ref.get("sourceTree") == "SOURCE_ROOT" else None)
check("App compile phase includes every app/core Swift file exactly once", len(compiled_sources) == len(sources) and set(compiled_sources) == {p.relative_to(ROOT).as_posix() for p in sources})
configs = [o["buildSettings"] for o in objects.values() if o["isa"] == "XCBuildConfiguration"]
check("iOS 16 minimum deployment target", any(c.get("IPHONEOS_DEPLOYMENT_TARGET") == "16.0" for c in configs))
check("Standard device/simulator architectures, no CPU exclusion list", not any(any(key.startswith(("EXCLUDED_ARCHS", "VALID_ARCHS")) for key in c) for c in configs))
check("App targets both iPhone and iPad", all(c["TARGETED_DEVICE_FAMILY"] == "1,2" for c in configs if "TARGETED_DEVICE_FAMILY" in c))
check("Signing team is unset or has Team ID format; owner must verify ownership", all(not c.get("DEVELOPMENT_TEAM") or re.fullmatch(r"[A-Z0-9]{10}", c["DEVELOPMENT_TEAM"]) for c in configs))
scheme = ET.parse(ROOT / "AlmadinaExpress.xcodeproj/xcshareddata/xcschemes/AlmadinaExpress.xcscheme")
check("Shared scheme references valid native targets", all(r.attrib["BlueprintIdentifier"] in objects for r in scheme.findall(".//BuildableReference")))
check("Shared scheme contains UI test action", len(scheme.findall(".//TestableReference")) == 1)

icon = (ROOT / "App/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png").read_bytes()
width, height, depth, color_type = struct.unpack(">IIBB", icon[16:26])
check("App icon is 1024 square, RGB, no alpha", icon.startswith(b"\x89PNG\r\n\x1a\n") and (width, height, depth, color_type) == (1024,1024,8,2))
brand_path = ROOT / "App/Resources/Assets.xcassets/BrandMark.imageset/BrandMark.png"
check("In-app brand artwork is identical to the app icon", brand_path.is_file() and brand_path.read_bytes() == icon)
for path in ROOT.glob("App/Resources/Assets.xcassets/**/Contents.json"):
    contents = json.loads(path.read_text())
    check("Asset JSON: " + path.parent.name, isinstance(contents.get("info", {}).get("version"), int))
    for item in contents.get("images", []): check("Asset image exists: " + item.get("filename", ""), (path.parent / item.get("filename", "missing")).is_file())

code = "\n".join(p.read_text() for p in sources)
balanced = True
for path in sources + list(ROOT.glob("Tests/**/*.swift")) + list(ROOT.glob("UITests/*.swift")):
    try: swift_delimiters(path.read_text())
    except ValueError as error: print(str(path.relative_to(ROOT)) + ": " + str(error)); balanced = False
check("Swift delimiters, strings and interpolations balance structurally", balanced)
check("Native SwiftUI entry point exists exactly once", len(re.findall(r"@main\b", code)) == 1 and "WindowGroup" in code)
check("No web wrapper, remote script execution or third-party packages", not any(x in code for x in ["WKWebView", "UIWebView", "evaluateJavaScript", "import WebKit"]) and ".package(" not in read("Package.swift"))
check("Camera processes QR metadata natively", "AVCaptureMetadataOutput" in code and "requestAccess(for: .video)" in code)
check("QR assignment has no editable tracking-number field", 'title: "أدخل الكود المطبوع"' not in code and "orders/assign-code" in code)
check("New order explicitly leaves code empty", '"trackingNumber": ""' in read("Sources/AlmadinaCore/BusinessRules.swift"))
check("Preferred date uses actual server field", '"preferredDeliveryDate"' in read("Sources/AlmadinaCore/BusinessRules.swift") and '"preferredDate":' not in read("Sources/AlmadinaCore/BusinessRules.swift"))
check("Secure device-bound storage and biometric ACL present", "biometryCurrentSet" in code and "kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly" in code and "AES.GCM.seal" in code)
check("Session requests reject redirects before following them", "NoRedirectDelegate" in code and "completionHandler(nil)" in code)
check("No camera/photo/video upload API in app", not any(x in code for x in ["AVCapturePhotoOutput", "AVCaptureMovieFileOutput", "UIImagePickerController", "PHPhotoLibrary"]))
check("Unknown server data and revisions preserved", '"revision": .number(Double(current.revision))' in code and '"database": .object(next)' in code)
check("30-day trash retention and invoice QR verification included", "30 * 86400" in code and "collections/verify" in code)
check("App account-deletion endpoint wired", '"account/delete"' in code and '"حذف حسابي"' in code)
request_action = read("App/State/AccountActions.swift").split("func requestAccountDeletion", 1)[-1].split("func markNotice", 1)[0]
check("Deletion request has its own endpoint and preserves the account session", '"account/deletion-request"' in request_action and "clearSession()" not in request_action and "disableBiometrics()" not in request_action and "AccountDeletionState(payload)" in request_action)
check("Immediate account deletion requires fetched server eligibility", 'deletionState?.eligible == true && !loadFailed' in read("App/Views/SettingsViews.swift"))
check("Responsive iPhone/iPad navigation and Arabic RTL present", "NavigationSplitView" in code and "rightToLeft" in code and "GridItem(.adaptive" in code and "ViewThatFits" in code)
check("UI tests never automatically call production API", "--ui-test-no-network" in read("UITests/AlmadinaExpressUITests.swift") and "--ui-test-no-network" in read("App/AlmadinaApp.swift"))

unit_count = len(re.findall(r"func test\w+", read("Tests/AlmadinaCoreTests/AlmadinaCoreTests.swift")))
ui_count = len(re.findall(r"func test\w+", read("UITests/AlmadinaExpressUITests.swift")))
check("Core regression and UI smoke test sources supplied", unit_count >= 30 and ui_count >= 3)
if args.release:
    policy_url = urlparse(info.get("AlmadinaPrivacyPolicyURL", ""))
    check("Owner supplied public HTTPS privacy policy URL", policy_url.scheme == "https" and policy_url.hostname and not policy_url.username and not policy_url.password)
    deletion_url = urlparse(info.get("AlmadinaAccountDeletionURL", ""))
    check("Public HTTPS account deletion page configured", deletion_url.scheme == "https" and deletion_url.hostname and not deletion_url.username and not deletion_url.password)
    support_url = urlparse(info.get("AlmadinaSupportURL", ""))
    check("Public HTTPS support page configured", support_url.scheme == "https" and support_url.hostname and not support_url.username and not support_url.password)
    if info.get("AlmadinaSupportPhoneConfirmed") is True:
        check("Confirmed local support phone is nonempty", len(re.sub(r"\D", "", info.get("AlmadinaSupportPhone", ""))) >= 7)
    check("Owner completed release checklist sign-off", info.get("AlmadinaReleaseChecklistConfirmed") is True)
else:
    print("PENDING: publish and verify privacy/deletion/support pages, confirm official contact channels and retention policy, test and sign on a Mac.")
print(f"SUMMARY: {sum(ok for _, ok in checks)}/{len(checks)} static checks passed; {unit_count} unit and {ui_count} UI tests supplied, NOT executed by this script.")
print("This result is not Swift compilation, device verification, signing, or Apple approval.")
sys.exit(0 if all(ok for _, ok in checks) else 1)
