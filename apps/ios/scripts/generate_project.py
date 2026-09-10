#!/usr/bin/env python3
"""Generate the checked-in, dependency-free Xcode project and shared scheme.

Run only after adding/removing source files. XcodeGen/CocoaPods are not needed.
This deterministic generator preserves no user signing settings: configure the
team in Xcode again after regenerating, or use DEVELOPMENT_TEAM at build time.
"""
import copy
import hashlib
import json
import pathlib
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = "AlmadinaExpress"
objects = {}

def uid(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()

class Ref(str):
    pass

def ref(name):
    return Ref(uid(name))

def add(object_name, isa, **values):
    identifier = uid(object_name)
    assert identifier not in objects
    objects[identifier] = dict(isa=isa, **values)
    return Ref(identifier)

def serialize(value, indent=0):
    if isinstance(value, Ref):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return "(" + ", ".join(serialize(v, indent) for v in value) + ("," if value else "") + ")"
    if isinstance(value, dict):
        prefix = "\t" * (indent + 1)
        return "{\n" + "".join(prefix + json.dumps(k) + " = " + serialize(v, indent + 1) + ";\n" for k, v in value.items()) + "\t" * indent + "}"
    raise TypeError(type(value))

app_sources = sorted(list(ROOT.glob("App/**/*.swift")) + list(ROOT.glob("Sources/AlmadinaCore/*.swift")))
ui_sources = sorted(ROOT.glob("UITests/*.swift"))
assert app_sources and ui_sources

def files(paths, phase):
    refs, builds = [], []
    for path in paths:
        relative = path.relative_to(ROOT).as_posix()
        file_ref = add("file:" + relative, "PBXFileReference", lastKnownFileType="sourcecode.swift", path=relative, sourceTree="SOURCE_ROOT")
        refs.append(file_ref)
        builds.append(add("build:" + relative, "PBXBuildFile", fileRef=file_ref))
    add(phase, "PBXSourcesBuildPhase", buildActionMask=2147483647, files=builds, runOnlyForDeploymentPostprocessing=0)
    return refs

app_refs = files(app_sources, "app-sources")
ui_refs = files(ui_sources, "ui-sources")
resource_refs, resource_builds = [], []
for path, file_type in [("App/Resources/Assets.xcassets", "folder.assetcatalog"), ("App/Resources/PrivacyInfo.xcprivacy", "text.xml")]:
    file_ref = add("file:" + path, "PBXFileReference", lastKnownFileType=file_type, path=path, sourceTree="SOURCE_ROOT")
    resource_refs.append(file_ref)
    resource_builds.append(add("build:" + path, "PBXBuildFile", fileRef=file_ref))
resource_refs.append(add("info", "PBXFileReference", lastKnownFileType="text.plist.xml", path="App/Resources/Info.plist", sourceTree="SOURCE_ROOT"))
add("app-resources", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=resource_builds, runOnlyForDeploymentPostprocessing=0)
add("ui-resources", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
for name in ["app-frameworks", "ui-frameworks"]:
    add(name, "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
app_product = add("app-product", "PBXFileReference", explicitFileType="wrapper.application", includeInIndex=0, path=APP + ".app", sourceTree="BUILT_PRODUCTS_DIR")
ui_product = add("ui-product", "PBXFileReference", explicitFileType="wrapper.cfbundle", includeInIndex=0, path=APP + "UITests.xctest", sourceTree="BUILT_PRODUCTS_DIR")
add("sources-group", "PBXGroup", name="App and Core", children=app_refs, sourceTree="<group>")
add("resources-group", "PBXGroup", name="Resources", children=resource_refs, sourceTree="<group>")
add("ui-group", "PBXGroup", name="UITests", children=ui_refs, sourceTree="<group>")
add("products", "PBXGroup", name="Products", children=[app_product, ui_product], sourceTree="<group>")
add("main-group", "PBXGroup", children=[ref("sources-group"), ref("resources-group"), ref("ui-group"), ref("products")], sourceTree="<group>")

project_common = dict(CLANG_ENABLE_MODULES="YES", CLANG_ENABLE_OBJC_ARC="YES", GCC_C_LANGUAGE_STANDARD="gnu17", IPHONEOS_DEPLOYMENT_TARGET="16.0", SDKROOT="iphoneos", SWIFT_VERSION="5.0", ENABLE_USER_SCRIPT_SANDBOXING="YES")
app_common = dict(PRODUCT_NAME=APP, PRODUCT_BUNDLE_IDENTIFIER="com.almadinaexpress.ios", MARKETING_VERSION="1.0.12", CURRENT_PROJECT_VERSION="13", CODE_SIGN_STYLE="Automatic", DEVELOPMENT_TEAM="", INFOPLIST_FILE="App/Resources/Info.plist", GENERATE_INFOPLIST_FILE="NO", TARGETED_DEVICE_FAMILY="1,2", SUPPORTED_PLATFORMS="iphoneos iphonesimulator", SUPPORTS_MACCATALYST="NO", SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD="NO", ASSETCATALOG_COMPILER_APPICON_NAME="AppIcon", ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME="AccentColor", LD_RUNPATH_SEARCH_PATHS=["$(inherited)", "@executable_path/Frameworks"], SWIFT_EMIT_LOC_STRINGS="YES")
ui_common = dict(PRODUCT_NAME="$(TARGET_NAME)", PRODUCT_BUNDLE_IDENTIFIER="com.almadinaexpress.ios.uitests", GENERATE_INFOPLIST_FILE="YES", TARGETED_DEVICE_FAMILY="1,2", SUPPORTED_PLATFORMS="iphoneos iphonesimulator", CODE_SIGN_STYLE="Automatic", DEVELOPMENT_TEAM="", TEST_TARGET_NAME=APP)
for target, common in [("project", project_common), ("app", app_common), ("ui", ui_common)]:
    configs = []
    for configuration in ["Debug", "Release"]:
        settings = dict(common)
        if target == "project":
            settings.update(ONLY_ACTIVE_ARCH="YES" if configuration == "Debug" else "NO", SWIFT_OPTIMIZATION_LEVEL="-Onone" if configuration == "Debug" else "-O", DEBUG_INFORMATION_FORMAT="dwarf" if configuration == "Debug" else "dwarf-with-dsym")
            if configuration == "Debug":
                settings.update(SWIFT_ACTIVE_COMPILATION_CONDITIONS="DEBUG $(inherited)", ENABLE_TESTABILITY="YES")
        configs.append(add(target + "-" + configuration, "XCBuildConfiguration", buildSettings=settings, name=configuration))
    add(target + "-config", "XCConfigurationList", buildConfigurations=configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")

add("ui-proxy", "PBXContainerItemProxy", containerPortal=ref("project"), proxyType=1, remoteGlobalIDString=ref("app-target"), remoteInfo=APP)
add("ui-dependency", "PBXTargetDependency", target=ref("app-target"), targetProxy=ref("ui-proxy"))
add("app-target", "PBXNativeTarget", buildConfigurationList=ref("app-config"), buildPhases=[ref("app-sources"), ref("app-frameworks"), ref("app-resources")], buildRules=[], dependencies=[], name=APP, productName=APP, productReference=app_product, productType="com.apple.product-type.application")
add("ui-target", "PBXNativeTarget", buildConfigurationList=ref("ui-config"), buildPhases=[ref("ui-sources"), ref("ui-frameworks"), ref("ui-resources")], buildRules=[], dependencies=[ref("ui-dependency")], name=APP + "UITests", productName=APP + "UITests", productReference=ui_product, productType="com.apple.product-type.bundle.ui-testing")
add("project", "PBXProject", attributes={"BuildIndependentTargetsInParallel": "YES", "LastUpgradeCheck": "2600", "LastSwiftUpdateCheck": "2600", "TargetAttributes": {uid("app-target"): {"CreatedOnToolsVersion": "26.0"}, uid("ui-target"): {"CreatedOnToolsVersion": "26.0", "TestTargetID": ref("app-target")}}}, buildConfigurationList=ref("project-config"), compatibilityVersion="Xcode 14.0", developmentRegion="ar", hasScannedForEncodings=0, knownRegions=["ar", "en", "Base"], mainGroup=ref("main-group"), productRefGroup=ref("products"), projectDirPath="", projectRoot="", targets=[ref("app-target"), ref("ui-target")])

project = ROOT / (APP + ".xcodeproj")
project.mkdir(exist_ok=True)
data = {"archiveVersion": 1, "classes": {}, "objectVersion": 56, "objects": objects, "rootObject": ref("project")}
(project / "project.pbxproj").write_text("// !$*UTF8*$!\n" + serialize(data) + "\n")
scheme = ET.Element("Scheme", LastUpgradeVersion="2600", version="1.7")
build = ET.SubElement(scheme, "BuildAction", parallelizeBuildables="YES", buildImplicitDependencies="YES")
entries = ET.SubElement(build, "BuildActionEntries")

def buildable(parent, target="app"):
    name = APP if target == "app" else APP + "UITests"
    return ET.SubElement(parent, "BuildableReference", BuildableIdentifier="primary", BlueprintIdentifier=uid(target + "-target"), BuildableName=name + (".app" if target == "app" else ".xctest"), BlueprintName=name, ReferencedContainer="container:" + APP + ".xcodeproj")

for target in ["app", "ui"]:
    entry = ET.SubElement(entries, "BuildActionEntry", buildForTesting="YES", buildForRunning="YES" if target == "app" else "NO", buildForProfiling="YES" if target == "app" else "NO", buildForArchiving="YES" if target == "app" else "NO", buildForAnalyzing="YES" if target == "app" else "NO")
    buildable(entry, target)
test = ET.SubElement(scheme, "TestAction", buildConfiguration="Debug", selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB", selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB", shouldUseLaunchSchemeArgsEnv="YES")
testables = ET.SubElement(test, "Testables")
testable = ET.SubElement(testables, "TestableReference", skipped="NO", parallelizable="NO")
buildable(testable, "ui")
launch = ET.SubElement(scheme, "LaunchAction", buildConfiguration="Debug", selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB", selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB", launchStyle="0", useCustomWorkingDirectory="NO", ignoresPersistentStateOnLaunch="NO", debugDocumentVersioning="YES", debugServiceExtension="internal", allowLocationSimulation="YES")
buildable(ET.SubElement(launch, "BuildableProductRunnable", runnableDebuggingMode="0"))
profile = ET.SubElement(scheme, "ProfileAction", buildConfiguration="Release", shouldUseLaunchSchemeArgsEnv="YES", savedToolIdentifier="", useCustomWorkingDirectory="NO", debugDocumentVersioning="YES")
buildable(ET.SubElement(profile, "BuildableProductRunnable", runnableDebuggingMode="0"))
ET.SubElement(scheme, "AnalyzeAction", buildConfiguration="Debug")
ET.SubElement(scheme, "ArchiveAction", buildConfiguration="Release", revealArchiveInOrganizer="YES")
scheme_dir = project / "xcshareddata/xcschemes"
scheme_dir.mkdir(parents=True, exist_ok=True)
ET.indent(scheme)
ET.ElementTree(scheme).write(scheme_dir / (APP + ".xcscheme"), encoding="utf-8", xml_declaration=True)
# A separate local-device option avoids LLDB attachment without changing normal
# debugging, signing, entitlements, or the App Store archive configuration.
device_scheme = copy.deepcopy(scheme)
device_launch = device_scheme.find("LaunchAction")
device_launch.set("selectedDebuggerIdentifier", "")
device_launch.set("selectedLauncherIdentifier", "Xcode.IDEFoundation.Launcher.PosixSpawn")
ET.ElementTree(device_scheme).write(scheme_dir / (APP + "-Device.xcscheme"), encoding="utf-8", xml_declaration=True)
print(f"Generated {project.name}: {len(app_sources)} app/core Swift files, {len(ui_sources)} UI test files")
