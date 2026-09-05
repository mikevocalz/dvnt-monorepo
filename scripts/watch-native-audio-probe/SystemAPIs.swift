import Foundation
import CallKit
import PushKit
import AVFAudio

// Compiler-only probe. This function is never executed and starts no call.
func configureWatchAudio(_ registry: PKPushRegistry) throws {
    registry.desiredPushTypes = [.voIP]
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = false
    configuration.maximumCallsPerCallGroup = 1
    _ = CXProvider(configuration: configuration)
    try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat)
}
