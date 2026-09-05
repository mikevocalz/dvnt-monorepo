import Foundation

@main struct TicketSafetyTests {
    static func main() throws {
        let decoder = JSONDecoder()
        for raw in [#"{"id":"1","eventId":"2"}"#, #"{"id":"1","eventId":"2","status":"surprise"}"#,
                    #"{"id":"1","eventId":"2","status":true}"#, #"{"id":"1","eventId":"2","status":"cancelled"}"#] {
            let ticket = try decoder.decode(WatchTicket.self, from: Data(raw.utf8))
            precondition(!ticket.status.isPresentable && !ticket.status.displayLabel.isEmpty)
        }
        let valid = try decoder.decode(WatchTicket.self, from: Data(#"{"id":"1","eventId":"2","status":"valid"}"#.utf8))
        precondition(valid.status.isPresentable)
        precondition(WatchQRMatrix(size: Int.max, bits: "0").modules == nil)
        precondition(WatchQRMatrix(size: 22, bits: String(repeating: "0", count: 121)).modules == nil)
        precondition(WatchQRMatrix(size: 45, bits: String(repeating: "0", count: 506)).modules == nil)
        precondition(WatchQRMatrix(size: 45, bits: String(repeating: "0", count: 508)).modules == nil)
        precondition(WatchQRMatrix(size: 45, bits: String(repeating: "x", count: 507)).modules == nil)
        precondition(WatchQRMatrix(size: 45, bits: String(repeating: "Ｆ", count: 507)).modules == nil)
        precondition(WatchQRMatrix(size: 45, bits: String(repeating: "0", count: 507)).modules?.count == 2025)

        // Session scope. The phone and Wear both carry `protocol`/`accountGen` on
        // this envelope; watchOS ignored them, so a protocol-2 snapshot built for
        // a signed-out account could repopulate the wrist. Every other domain
        // compared the generation — tickets now do too.
        func envelope(_ json: String) throws -> WatchTicketEnvelope {
            try decoder.decode(WatchTicketEnvelope.self, from: Data(json.utf8))
        }
        let scoped = try envelope(#"{"protocol":2,"accountGen":"gen-A","tickets":[],"syncedAt":1}"#)
        precondition(scoped.protocol == 2 && scoped.accountGen == "gen-A")
        precondition(scoped.belongs(toGeneration: "gen-A"))
        precondition(!scoped.belongs(toGeneration: "gen-B"))
        precondition(!scoped.belongs(toGeneration: nil))
        precondition(!scoped.belongs(toGeneration: ""))
        // A protocol-2 envelope that names no generation cannot claim one.
        let unnamed = try envelope(#"{"protocol":2,"tickets":[],"syncedAt":1}"#)
        precondition(!unnamed.belongs(toGeneration: "gen-A"))
        // A released pre-protocol-2 phone sends neither field and must still show
        // its tickets, matching Wear's lenient path.
        let legacy = try envelope(#"{"tickets":[],"syncedAt":1}"#)
        precondition(legacy.protocol == nil && legacy.accountGen == nil)
        precondition(legacy.belongs(toGeneration: "gen-A") && legacy.belongs(toGeneration: nil))

        print("TicketSafety: missing/unknown/cancelled fail closed; QR bounds, exact hex length and canonical45 padding, generation scope passed")
    }
}
