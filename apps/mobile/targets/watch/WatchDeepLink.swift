import Foundation

struct WatchDeepLink: Identifiable, Equatable {
    let kind: String
    let target: String
    let accountGen: String
    var id: String { "\(accountGen)|\(kind)|\(target)" }
    init?(url: URL) {
        guard url.scheme == "dvnt-watch", ["ticket", "event"].contains(url.host ?? ""),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let target = components.queryItems?.first(where: { $0.name == "id" })?.value, !target.isEmpty,
              let generation = components.queryItems?.first(where: { $0.name == "accountGen" })?.value,
              !generation.isEmpty else { return nil }
        kind = url.host!; self.target = target; accountGen = generation
    }
}
