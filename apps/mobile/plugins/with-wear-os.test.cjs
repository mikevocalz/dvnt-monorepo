const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

test('two prebuild passes preserve module and install one phone listener/package/dependency', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-wear-prebuild-'));
  try {
    const mods = [];
    const stub = Object.fromEntries(['withAndroidManifest','withAppBuildGradle','withMainApplication','withProjectBuildGradle'].map(name =>
      [name, (config, callback) => { mods.push([name, callback]); return config; }]));
    stub.withDangerousMod = (config, [, callback]) => { mods.push(['dangerous', callback]); return config; };
    const module = {exports: {}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'with-wear-os.js'), 'utf8'), {
      require: id => id === 'expo/config-plugins' ? stub : require(id), module, __dirname, console: {log() {}, warn() {}},
    });
    fs.writeFileSync(path.join(root, 'settings.gradle'), "include ':app'\n");
    const results = {
      withAndroidManifest: {manifest: {application: [{$: {}}]}},
      withAppBuildGradle: {language: 'groovy', contents: 'dependencies {\n}\n'},
      withProjectBuildGradle: {language: 'groovy', contents: "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n"},
      withMainApplication: {contents: 'PackageList(this).packages.apply {\n}\n'},
    };
    for (let pass = 0; pass < 2; pass++) {
      mods.length = 0;
      module.exports({});
      for (const [name, callback] of mods) {
        const config = {modRequest: {platformProjectRoot: root, projectRoot: path.resolve(__dirname, '..')}, modResults: results[name]};
        const next = await callback(config);
        if (results[name]) results[name] = next.modResults;
      }
    }
    assert.equal((fs.readFileSync(path.join(root, 'settings.gradle'), 'utf8').match(/include ':wear'/g) || []).length, 1);
    assert.equal(results.withAndroidManifest.manifest.application[0].service.length, 1);
    assert.equal(results.withAndroidManifest.manifest.application[0].service[0].$['android:name'], 'com.dvnt.app.PhoneWearListenerService');
    assert.equal((results.withMainApplication.contents.match(/add\(WearBridgePackage\(\)\)/g) || []).length, 1);
    assert.equal((results.withAppBuildGradle.contents.match(/play-services-wearable/g) || []).length, 1);
    assert.equal((results.withProjectBuildGradle.contents.match(/compose-compiler-gradle-plugin/g) || []).length, 1);
    for (const name of ['WatchProtocol', 'DvntTileService', 'DvntComplicationService', 'CallNotifications']) {
      assert.ok(fs.existsSync(path.join(root, `wear/src/main/java/com/dvnt/app/wear/${name}.kt`)));
    }
    const wearManifest = fs.readFileSync(path.join(root, 'wear/src/main/AndroidManifest.xml'), 'utf8');
    assert.ok(wearManifest.includes('BIND_TILE_PROVIDER'));
    assert.ok(wearManifest.includes('BIND_COMPLICATION_PROVIDER'));
    assert.ok(wearManifest.includes('POST_NOTIFICATIONS'));
    assert.ok(!wearManifest.includes('USE_FULL_SCREEN_INTENT'));
    assert.ok(fs.readFileSync(path.join(root, 'app/src/main/java/com/dvnt/app/WearBridgeModule.kt'), 'utf8').includes('fun sendResponse'));
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
