import Foundation
import Observation
struct WatchActiveCallEnvelope: Codable {
    let `protocol`: Int; let accountGen: String; let syncedAt: Double; let expiresAt: Double
    let roomId: String?; let phase: String; let peerStatus: String; let name: String
    let isVideo: Bool; let muted: Bool; let canMute: Bool
}
struct WatchActiveCallCommand: Codable {
    let `protocol`: Int; let accountGen: String; let operationId: String; let type: String
    let roomId: String; let expectedStatus: String; let action: String; let muted: Bool?; let issuedAt: Double; let expiresAt: Double
}
struct WatchActiveCallResult: Codable {
    let `protocol`: Int; let accountGen: String; let operationId: String; let roomId: String; let status: String; let message: String?
}
@MainActor @Observable final class ActiveCallStore {
    private(set) var call: WatchActiveCallEnvelope?
    private(set) var presented = false
    private(set) var generation = ""
    private(set) var pending: String?
    private(set) var message: String?
    @ObservationIgnored var relay: ((WatchActiveCallCommand) -> Bool)?
    @ObservationIgnored private var latestStamp: Double = 0
    @ObservationIgnored private var retired: Set<String> = []
    func resetAccount(_ generation: String) {
        guard !generation.isEmpty, generation != self.generation, !retired.contains(generation) else { return }
        if !self.generation.isEmpty { retired.insert(self.generation) }
        self.generation = generation; call = nil; presented = false; pending = nil; message = nil; latestStamp = 0
    }
    func ingest(json: Data) { if let next = try? JSONDecoder().decode(WatchActiveCallEnvelope.self, from: json) { apply(next) } }
    func apply(_ next: WatchActiveCallEnvelope) {
        let now = Date().timeIntervalSince1970
        guard next.protocol == 2, !next.accountGen.isEmpty, !retired.contains(next.accountGen), next.syncedAt.isFinite, next.expiresAt.isFinite, next.syncedAt >= latestStamp, next.expiresAt > now, next.expiresAt - next.syncedAt <= 30 else { return }
        if next.accountGen != generation { resetAccount(next.accountGen) }
        latestStamp = next.syncedAt
        if next.phase == "ended" { call = nil; presented = false; pending = nil; message = nil; return }
        guard next.roomId != nil else { return }
        if call?.roomId != next.roomId { presented = true; pending = nil; message = nil }
        call = next
    }
    func dismiss() { presented = false }
    func act(_ action: String, muted: Bool? = nil) {
        guard let call, let room = call.roomId, pending == nil, call.expiresAt > Date().timeIntervalSince1970 else { return }
        let now = Date().timeIntervalSince1970
        let command = WatchActiveCallCommand(protocol: 2, accountGen: generation, operationId: UUID().uuidString, type: "activeCallAction", roomId: room, expectedStatus: call.phase, action: action, muted: muted, issuedAt: now, expiresAt: now + 30)
        pending = command.operationId; message = nil
        if relay?(command) != true { fail(command, message: "Phone unavailable. Check your phone."); return }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(32))
            guard let self, self.pending == command.operationId else { return }
            self.fail(command, message: "Result not confirmed. Check your phone.")
        }
    }
    func fail(_ command: WatchActiveCallCommand, message: String) { receive(WatchActiveCallResult(protocol: 2, accountGen: command.accountGen, operationId: command.operationId, roomId: command.roomId, status: "failed", message: message)) }
    func receive(_ result: WatchActiveCallResult) {
        guard result.protocol == 2, result.accountGen == generation, result.roomId == call?.roomId, result.operationId == pending else { return }
        pending = nil; message = result.message
    }
}
