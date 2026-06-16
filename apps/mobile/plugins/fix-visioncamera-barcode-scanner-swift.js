/**
 * Expo Config Plugin: Stabilize VisionCameraBarcodeScanner Swift compilation
 *
 * Xcode 26 can crash the Swift frontend while incrementally compiling the
 * Nitrogen-generated Swift sources in react-native-vision-camera-barcode-scanner.
 * Pinning the pod to Swift 5.9 and whole-module compilation avoids the crash
 * in local simulator builds and EAS preview builds.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withFixVisionCameraBarcodeScannerSwift(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile",
      );
      let podfile = fs.readFileSync(podfilePath, "utf8");

      const snippet = `
    # [fix-visioncamera-barcode-scanner-swift] Xcode 26 can crash while
    # incrementally compiling Nitrogen-generated Swift in
    # VisionCameraBarcodeScanner. Pin the pod to Swift 5.9 and whole-module
    # compilation so local dev and EAS preview builds stay stable.
    installer.pods_project.targets.each do |target|
      next unless target.name == 'VisionCameraBarcodeScanner'
      target.build_configurations.each do |config|
        config.build_settings['SWIFT_VERSION'] = '5.9'
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
        config.build_settings['SWIFT_COMPILATION_MODE'] = 'wholemodule'
      end
    end`;

      if (!podfile.includes("[fix-visioncamera-barcode-scanner-swift]")) {
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

module.exports = withFixVisionCameraBarcodeScannerSwift;
