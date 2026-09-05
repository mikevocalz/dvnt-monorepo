#!/usr/bin/env python3
"""Read installed SDK/platforms and compile isolated positive/negative probes; no network or calls."""
import json
import pathlib
import plistlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FRAMEWORK = ROOT / "apps/mobile/ios/Pods/FishjamWebRTC/WebRTC.xcframework"

def run(args):
    result = subprocess.run([str(arg) for arg in args], text=True, capture_output=True)
    return {"exitCode":result.returncode, "output":(result.stdout + result.stderr).strip()}

metadata = plistlib.loads((FRAMEWORK / "Info.plist").read_bytes())
pod = json.loads((ROOT / "apps/mobile/ios/Pods/Local Podspecs/FishjamReactNativeWebrtc.podspec.json").read_text())
report = {"wrapperVersion":pod["version"], "wrapperPlatforms":pod["platforms"], "mediaDependency":pod["dependencies"]["FishjamWebRTC"],
    "availableLibraries":metadata["AvailableLibraries"], "nativeWatchMediaAvailable":any(row.get("SupportedPlatform") == "watchos" for row in metadata["AvailableLibraries"])}
with tempfile.TemporaryDirectory(prefix="dvnt-watch-audio-probe-") as scratch:
    scratch = pathlib.Path(scratch)
    sdk = subprocess.check_output(["xcrun","--sdk","watchos","--show-sdk-path"],text=True).strip()
    simulator_sdk = subprocess.check_output(["xcrun","--sdk","watchsimulator","--show-sdk-path"],text=True).strip()
    report["systemAPIs"] = run(["xcrun","swiftc","-typecheck","-sdk",sdk,"-target","arm64_32-apple-watchos10.0","-module-cache-path",scratch / "swift-cache", pathlib.Path(__file__).with_name("SystemAPIs.swift")])
    # Same CPU architecture, deliberately different OS: proves arm64 is insufficient.
    main = scratch / "main.c"
    main.write_text("int main(void) { return 0; }\n")
    report["iosBinaryAsWatchSimulator"] = run(["xcrun","clang","-target","arm64-apple-watchos10.0-simulator","-isysroot",simulator_sdk,
        "-F",FRAMEWORK / "ios-arm64_x86_64-simulator","-framework","WebRTC",main,"-o",scratch / "probe"])
    report["deviceBinaryPlatform"] = run(["xcrun","vtool","-show-build",FRAMEWORK / "ios-arm64/WebRTC.framework/WebRTC"])
print(json.dumps(report,indent=2))
if report["systemAPIs"]["exitCode"] != 0:
    raise SystemExit("System API probe failed; inspect report")
if not report["nativeWatchMediaAvailable"] and report["iosBinaryAsWatchSimulator"]["exitCode"] == 0:
    raise SystemExit("Unexpected cross-platform link success; audit platform assumptions")
