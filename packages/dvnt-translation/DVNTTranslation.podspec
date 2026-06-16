require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'DVNTTranslation'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = { :type => 'MIT' }
  s.author         = 'DVNT'
  s.homepage       = 'https://github.com/dvnt'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "ios/**/*.{h,m,mm,swift,hpp,cpp}"

  # Weak-link Apple's Translation framework (iOS 18.0+).
  # Pod name is DVNTTranslation, so `import Translation` unambiguously
  # resolves to Apple's system framework — no module_name override needed.
  s.weak_framework = 'Translation'
end
