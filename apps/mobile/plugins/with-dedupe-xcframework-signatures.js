/**
 * Dedupe XCFramework signature files before archive assembly.
 *
 * A binary SPM xcframework (MoqFFI, via moq-kit) gets a SignatureCollection
 * step once per consuming context: the SPM package build writes
 *   Release-iphoneos/MoqFFI.xcframework-ios.signature
 * and the CocoaPods pod consuming it (MoQ) writes its own copy into its
 * per-pod products subdir
 *   Release-iphoneos/MoQ/MoqFFI.xcframework-ios.signature
 * Archive assembly then flattens every *.signature into one Signatures/
 * folder and dies on the basename collision:
 *   "MoqFFI.xcframework-ios.signature" couldn't be copied to "Signatures"
 *   because an item with the same name already exists.
 * (Killed WS-3a twice on EAS; first reproduced locally in archive2.log,
 * SignatureCollection steps at lines 2878/2882.)
 *
 * Both files are signatures of the SAME xcframework, so the per-pod copies
 * are redundant. This adds a late shell phase on the app target — the last
 * target to build before archive assembly — deleting any *.signature found
 * below the top level of the products dir. No-op outside archives and in
 * projects with no binary SPM deps.
 */

const { withXcodeProject } = require("expo/config-plugins");

const PHASE_NAME = "Dedupe XCFramework Signatures";

const SCRIPT = `# ponytail: keep the root signature, drop per-pod duplicates — archive
# assembly flattens them all into Signatures/ and dies on basename collision.
if [ -d "$BUILT_PRODUCTS_DIR" ]; then
  find "$BUILT_PRODUCTS_DIR" -mindepth 2 -name '*.xcframework-*.signature' -print -delete
fi
`;

function withDedupeXcframeworkSignatures(config) {
  return withXcodeProject(config, (config) => {
    const proj = config.modResults;
    const phases = proj.hash.project.objects.PBXShellScriptBuildPhase || {};
    const exists = Object.values(phases).some(
      (p) => p && p.name && p.name.includes("Dedupe XCFramework"),
    );
    if (!exists) {
      proj.addBuildPhase(
        [],
        "PBXShellScriptBuildPhase",
        PHASE_NAME,
        proj.getFirstTarget().uuid,
        {
          shellPath: "/bin/sh",
          shellScript: SCRIPT,
        },
      );
      console.log("[with-dedupe-xcframework-signatures] Added build phase");
    }
    return config;
  });
}

module.exports = withDedupeXcframeworkSignatures;
