/**
 * Force specific pods to build as STATIC frameworks under `use_frameworks! :dynamic`.
 *
 * Why expo-build-properties' `ios.forceStaticLinking` can't do this:
 * expo-modules-autolinking/scripts/ios/cocoapods/installer.rb gates its
 * build-type override on `ENV['RCT_USE_PREBUILT_RNCORE'] == '1'` — it exists
 * to serve the precompiled-RN path. This app builds React Native FROM SOURCE
 * (see app.config.js, buildReactNativeFromSource), which sets that env to '0',
 * so forceStaticLinking prints "Forcing static linking for pods: [...]" and
 * then silently does nothing (verified: build 5e13c670 still linked
 * FishjamReactNativeWebrtc dynamically).
 *
 * So we do what upstream react-native-moq's own example Podfile does for its
 * problem pods (RNAudioAPI, react-native-executorch): a raw CocoaPods
 * pre_install hook overriding build_type. pre_install, not post_install —
 * build_type must be fixed before CocoaPods generates the pod targets.
 *
 * Current list:
 *  - VisionCameraBarcodeScanner: links Google MLKit's prebuilt static
 *    xcframeworks; as a dynamic framework GMLImage/MLKBarcode* stay undefined.
 *  - FishjamReactNativeWebrtc: its FJ*JSI.o objects reference concrete
 *    facebook::jsi::* symbols (HostObject vtables, Value dtors, typeinfo)
 *    that stay undefined when it links as its own dynamic framework, even
 *    with -framework "jsi" in its OTHER_LDFLAGS. Every other JSI consumer
 *    (Reanimated, Screens, SVG, skia) links clean, so it's this pod, not the
 *    setup. Static-framework linkage resolves the symbols at app link.
 *    Failed identically with MoQ absent (b0a10cdf) and present (1e013b96).
 *    This entry dies with the Fishjam dependency when WS-3b lands.
 */

const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# ── force-static pods (with-static-pods) ──";

const PRE_INSTALL_SNIPPET = `${MARKER}
# See apps/mobile/plugins/with-static-pods.js for why each pod is listed.
STATIC_FRAMEWORK_PODS = [
  'FishjamReactNativeWebrtc',
  # Consumes Google MLKit, which ships prebuilt STATIC xcframeworks
  # (GMLImage / MLKBarcode* undefined when this pod links as its own dynamic
  # framework). Same class as upstream moq's RNAudioAPI force-static.
  'VisionCameraBarcodeScanner',
]
pre_install do |installer|
  installer.pod_targets.each do |pod|
    if STATIC_FRAMEWORK_PODS.include?(pod.name)
      Pod::UI.puts "[with-static-pods] Building #{pod.name} as a static framework"
      def pod.build_type
        Pod::BuildType.static_framework
      end
    end
  end
end`;

function injectPreInstallHook(podfilePath) {
  let podfile = fs.readFileSync(podfilePath, "utf8");
  // Idempotent by content: strip any previous block (marker through the
  // closing "end" of the pre_install), then re-inject the current one — a
  // marker-only guard pins reused Podfiles (local or EAS build cache) to a
  // stale pod list.
  const prev = podfile.indexOf(MARKER);
  if (prev !== -1) {
    const rest = podfile.slice(prev);
    const endIdx = rest.indexOf("\nend\n");
    if (endIdx === -1) throw new Error("[with-static-pods] Corrupt existing block");
    podfile = podfile.slice(0, prev) + podfile.slice(prev + endIdx + "\nend\n".length).replace(/^\n/, "");
  }

  // A Podfile allows one pre_install block; the generated Expo Podfile has
  // none, so inject ours before the first `target` declaration.
  const lines = podfile.split("\n");
  const targetIdx = lines.findIndex((l) => /^target ['"]/.test(l.trim()));
  if (targetIdx === -1) {
    throw new Error("[with-static-pods] No target declaration found in Podfile");
  }
  lines.splice(targetIdx, 0, PRE_INSTALL_SNIPPET, "");
  fs.writeFileSync(podfilePath, lines.join("\n"), "utf8");
  console.log("[with-static-pods] Injected Podfile pre_install hook");
}

function withStaticPods(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile",
      );
      injectPreInstallHook(podfilePath);
      return config;
    },
  ]);
}

module.exports = withStaticPods;
