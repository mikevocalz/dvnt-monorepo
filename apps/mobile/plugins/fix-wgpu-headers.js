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
        blob_dir = '"$(PODS_CONFIGURATION_BUILD_DIR)/React-RCTBlob"'
        fsp << blob_dir unless fsp.include?(blob_dir)
        config.build_settings['FRAMEWORK_SEARCH_PATHS'] = fsp

        ldflags = config.build_settings['OTHER_LDFLAGS'] || ['$(inherited)']
        ldflags = [ldflags] if ldflags.is_a?(String)
        # Product MODULE name, not pod name: the React-RCTBlob pod builds
        # RCTBlob.framework (React-CoreModules links -framework RCTBlob).
        unless ldflags.join(' ').include?('RCTBlob')
          ldflags += ['-framework', '"RCTBlob"']
        end
        config.build_settings['OTHER_LDFLAGS'] = ldflags
      end
    end

    # [fix-wgpu-headers] Not wgpu-specific, same pass: under RN-from-source +
    # dynamic frameworks, jsinspector_modern.framework's headers include
    # "jsinspector-modern/cdp/CdpJson.h" etc., which live in the SIBLING
    # frameworks (cdp / network / tracing). Any pod that builds the React
    # module re-parses those headers and fails unless the siblings' Headers
    # dirs are searchable (first seen: ReactNativeVideo, build 38b680cf).
    # Namespaced header layouts, so adding them everywhere cannot collide.
    jsinspector_headers = [
      'React-jsinspector/jsinspector_modern.framework/Headers',
      'React-jsinspectorcdp/jsinspector_moderncdp.framework/Headers',
      'React-jsinspectornetwork/jsinspector_modernnetwork.framework/Headers',
      'React-jsinspectortracing/jsinspector_moderntracing.framework/Headers',
    ].map { |p| '"$(PODS_CONFIGURATION_BUILD_DIR)/' + p + '"' }
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |config|
        paths = config.build_settings['HEADER_SEARCH_PATHS'] || ['$(inherited)']
        paths = [paths] if paths.is_a?(String)
        jsinspector_headers.each { |e| paths << e unless paths.include?(e) }
        # Nitro modules: nitrogen generates bare cross-includes
        # ("ResizeMode.hpp" from the ios/ umbrella, file in shared/c++/) that
        # static builds resolved via the flattened headers dir. The layout is
        # identical for every nitrogen package, and a search path to a dir
        # that doesn't exist is a no-op — so add the trio unconditionally
        # rather than maintaining a nitro-pod list (first seen:
        # ReactNativeVideo, build fa65ad1c).
        %w[nitrogen/generated/shared/c++ nitrogen/generated/ios nitrogen/generated/ios/c++].each do |d|
          entry = '"$(PODS_TARGET_SRCROOT)/' + d + '"'
          paths << entry unless paths.include?(entry)
        end
        config.build_settings['HEADER_SEARCH_PATHS'] = paths
      end
    end`;

      // Idempotent by CONTENT, not by marker: a marker-guard means an edited
      // snippet never re-injects over an existing Podfile (bit us — local
      // Podfile carried a stale copy while EAS regenerated fresh). Strip any
      // previous [fix-wgpu-headers] block, then inject the current one.
      const blockStart = podfile.indexOf("    # [fix-wgpu-headers]");
      if (blockStart !== -1) {
        // The injected snippet ends right before the post_install closing
        // "\n  end\nend" it was inserted against; find the block's end as the
        // next line that dedents to "  end" at column 2.
        const rest = podfile.slice(blockStart);
        const endIdx = rest.indexOf("\n  end\nend");
        if (endIdx !== -1) {
          podfile = podfile.slice(0, blockStart).replace(/\n$/, "") +
            podfile.slice(blockStart + endIdx);
        }
      }
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
