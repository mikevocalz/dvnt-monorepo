/**
 * Expo Config Plugin: Fix react-native-wgpu header collision with @shopify/react-native-skia
 *
 * Both packages share 6 identically-named C++ headers. CocoaPods flattens private
 * headers into Pods/Headers/Private/<pod>/ and the Xcode project-level header map
 * can resolve bare #include "X.h" to Skia's copy instead of wgpu's, causing
 * 'utils/RNSkLog.h' file not found errors.
 *
 * The primary fix is in scripts/patch-wgpu.sh which qualifies all colliding includes
 * with jsi/ or ./ prefixes so they bypass header-map bare-filename lookup.
 *
 * This plugin is belt-and-suspenders: it ensures wgpu's cpp/ and cpp/jsi/ are in
 * HEADER_SEARCH_PATHS so the qualified includes resolve correctly.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withFixWgpuHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile",
      );
      let podfile = fs.readFileSync(podfilePath, "utf8");

      const snippet = `
    # [fix-wgpu-headers] Ensure wgpu's cpp/ tree is in HEADER_SEARCH_PATHS so
    # qualified includes like "jsi/NativeObject.h" resolve to wgpu's own headers
    # instead of Skia's identically-named copies.
    installer.pods_project.targets.each do |t|
      next unless t.name == 'react-native-wgpu'
      t.build_configurations.each do |config|
        paths = config.build_settings['HEADER_SEARCH_PATHS'] || ['$(inherited)']
        paths = [paths] if paths.is_a?(String)
        paths << '"$(PODS_TARGET_SRCROOT)/cpp"' unless paths.any? { |p| p.include?('PODS_TARGET_SRCROOT)/cpp"') }
        paths << '"$(PODS_TARGET_SRCROOT)/cpp/jsi"' unless paths.any? { |p| p.include?('cpp/jsi') }
        config.build_settings['HEADER_SEARCH_PATHS'] = paths
      end
    end`;

      // Inject just before the closing '  end' of the post_install block
      if (!podfile.includes("[fix-wgpu-headers]")) {
        const marker = "\n  end\nend";
        const idx = podfile.lastIndexOf(marker);
        if (idx !== -1) {
          podfile =
            podfile.slice(0, idx) +
            snippet +
            marker +
            podfile.slice(idx + marker.length);
        }
      }

      fs.writeFileSync(podfilePath, podfile, "utf8");
      return config;
    },
  ]);
}

module.exports = withFixWgpuHeaders;
