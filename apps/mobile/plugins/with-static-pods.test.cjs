const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

// The pods that must link statically. RNAudioAPI is the one this test exists
// for: as its own dynamic framework its link step cannot resolve the ffmpeg
// symbols, because CocoaPods puts -framework "libavcodec" and friends only on
// the app target. See the header comment in with-static-pods.js.
const REQUIRED = ['FishjamReactNativeWebrtc', 'VisionCameraBarcodeScanner', 'RNAudioAPI'];

const GENERATED_PODFILE = `require File.join(File.dirname(\`node --print "require.resolve('expo/package.json')"\`), "scripts/autolinking")
platform :ios, '16.4'
prepare_react_native_project!

target 'DVNT' do
  use_expo_modules!
end
`;

function runPlugin(root) {
  const mods = [];
  const stub = {
    withDangerousMod: (config, [, callback]) => { mods.push(callback); return config; },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'with-static-pods.js'), 'utf8'), {
    require: (id) => (id === 'expo/config-plugins' ? stub : require(id)),
    module,
    __dirname,
    console: { log() {} },
  });
  module.exports({});
  for (const callback of mods) {
    callback({ modRequest: { platformProjectRoot: root } });
  }
  return fs.readFileSync(path.join(root, 'Podfile'), 'utf8');
}

test('every force-static pod is injected exactly once, and a second pass does not stack blocks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-static-pods-'));
  try {
    fs.writeFileSync(path.join(root, 'Podfile'), GENERATED_PODFILE);

    const first = runPlugin(root);
    for (const pod of REQUIRED) {
      assert.equal((first.match(new RegExp(`'${pod}'`, 'g')) || []).length, 1, `${pod} listed once`);
    }
    assert.equal((first.match(/pre_install do \|installer\|/g) || []).length, 1);
    // The hook has to land before the target, or CocoaPods has already built
    // the pod targets by the time build_type is overridden.
    assert.ok(first.indexOf('pre_install do |installer|') < first.indexOf("target 'DVNT' do"));

    const second = runPlugin(root);
    assert.equal(second, first, 'second prebuild pass is idempotent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a Podfile carrying a stale pod list is replaced, not appended to', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-static-pods-stale-'));
  try {
    // Reuse of a cached Podfile (local or EAS) that predates a list change.
    const stale = GENERATED_PODFILE.replace(
      "target 'DVNT' do",
      `# ── force-static pods (with-static-pods) ──
STATIC_FRAMEWORK_PODS = [
  'SomePodThatLeftTheList',
]
pre_install do |installer|
  installer.pod_targets.each do |pod|
  end
end

target 'DVNT' do`,
    );
    fs.writeFileSync(path.join(root, 'Podfile'), stale);

    const result = runPlugin(root);
    assert.ok(!result.includes('SomePodThatLeftTheList'), 'stale entry is dropped');
    assert.equal((result.match(/pre_install do \|installer\|/g) || []).length, 1);
    for (const pod of REQUIRED) {
      assert.equal((result.match(new RegExp(`'${pod}'`, 'g')) || []).length, 1);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
