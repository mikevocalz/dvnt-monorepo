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
    #
    # cpp/rnwgpu matters under dynamic-framework builds: apple/WebGPUModule.h
    # does a bare #import "RNWebGPUManager.h" and the header lives at
    # cpp/rnwgpu/. Static builds resolved it through CocoaPods' flattened
    # Pods/Headers/Private dir, which framework builds don't generate — and
    # the podspec sets USE_HEADERMAP=NO, so search paths are all that's left.
    installer.pods_project.targets.each do |t|
      # Pod renamed react-native-wgpu -> react-native-webgpu at 0.8.x; this
      # plugin matched only the old name for a while and was a silent no-op.
      next unless ['react-native-webgpu', 'react-native-wgpu'].include?(t.name)
      t.build_configurations.each do |config|
        paths = config.build_settings['HEADER_SEARCH_PATHS'] || ['$(inherited)']
        paths = [paths] if paths.is_a?(String)
        # The package bare-includes ("GPU.h", "JSIConverter.h", ...) across its
        # whole tree — written assuming the flattened Private-headers dir that
        # only static builds get. This is the COMPLETE list of header dirs
        # under cpp/ (enumerated with find, not discovered build-by-build).
        %w[cpp cpp/jsi cpp/rnwgpu cpp/rnwgpu/api cpp/rnwgpu/api/descriptors cpp/rnwgpu/async cpp/webgpu].each do |d|
          entry = '"$(PODS_TARGET_SRCROOT)/' + d + '"'
          paths << entry unless paths.include?(entry)
        end
        config.build_settings['HEADER_SEARCH_PATHS'] = paths

        # ApplePlatformContext.mm uses RCTBlobManager but the podspec never
        # declares React-RCTBlob. Static builds resolved the class at app
        # link; as a dynamic framework the pod must link it itself
        # (undefined _OBJC_CLASS_$_RCTBlobManager otherwise). The pod builds
        # regardless (React-Core dependents pull it in) — this only adds the
        # missing link edge.
        fsp = config.build_settings['FRAMEWORK_SEARCH_PATHS'] || ['$(inherited)']
        fsp = [fsp] if fsp.is_a?(String)
        blob_dir = '"${PODS_CONFIGURATION_BUILD_DIR}/React-RCTBlob"'
        fsp << blob_dir unless fsp.include?(blob_dir)
        config.build_settings['FRAMEWORK_SEARCH_PATHS'] = fsp

        ldflags = config.build_settings['OTHER_LDFLAGS'] || ['$(inherited)']
        ldflags = [ldflags] if ldflags.is_a?(String)
        unless ldflags.join(' ').include?('React_RCTBlob')
          ldflags += ['-framework', '"React_RCTBlob"']
        end
        config.build_settings['OTHER_LDFLAGS'] = ldflags
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
