import SwiftUI
struct CallDirectoryView: View {
    @Environment(CallDirectoryStore.self) private var store
    @Environment(ActiveCallStore.self) private var activeCallStore
    var body: some View {
        List {
            Section {
                if activeCallStore.call != nil { NavigationLink { ActiveCallView() } label: { Label("Current phone call", systemImage: "phone.connection") } }
                NavigationLink { CallRecipientPicker() } label: { Label("New call", systemImage: "phone.badge.plus") }
                Text("Continue calls on your phone").font(.caption2).foregroundStyle(.secondary)
            }
            if let error = store.error { Section { Text(error).font(.caption); Button("Refresh") { store.requestSync?() } } }
            if store.envelope.recents.isEmpty {
                Section { Text("No recent calls").font(.headline); Text("Choose people to start a call.").font(.caption).foregroundStyle(.secondary) }
            } else {
                Section("Recents") {
                    ForEach(store.envelope.recents) { recent in
                        NavigationLink { CallRecipientPicker(initial: Array(recent.people.prefix(3))) } label: {
                            HStack {
                                Image(systemName: recent.isVideo ? "video" : "phone").foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(recent.people.map(\.name).joined(separator: ", ")).lineLimit(2)
                                    Text(recentLabel(recent)).font(.caption2).foregroundStyle(.secondary)
                                    if let date = WatchEvent.date(recent.createdAt) { Text(date, style: .relative).font(.caption2).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                }
            }
        }.navigationTitle("Calls").onAppear { store.requestSync?() }.privacySensitive()
    }
    private func recentLabel(_ recent: WatchCallRecent) -> String {
        let direction = recent.direction == "incoming" ? "Incoming" : "Outgoing"
        // Signaling rows do not prove media connection or duration.
        let state = ["missed", "declined"].contains(recent.status) ? " · \(recent.status.capitalized)" : ""
        return direction + state
    }
}
private struct CallRecipientPicker: View {
    @Environment(CallDirectoryStore.self) private var store
    @State private var selected: [WatchCallPerson]
    @State private var query = ""
    init(initial: [WatchCallPerson] = []) { _selected = State(initialValue: initial) }
    var body: some View {
        List {
            Section {
                TextField("Search username", text: $query).onSubmit { store.search(query) }
                Button("Search") { store.search(query) }.disabled(query.trimmingCharacters(in: .whitespaces).isEmpty || store.pending != nil)
            }
            if !selected.isEmpty {
                Section("\(selected.count) of 3 people") {
                    ForEach(selected) { person in Button { selected.removeAll { $0.id == person.id } } label: { Label(person.name, systemImage: "checkmark.circle.fill") } }
                    Button { store.start(selected.map(\.id), video: false) } label: { Label("Audio on phone", systemImage: "phone.fill") }.disabled(store.pending != nil)
                    Button { store.start(selected.map(\.id), video: true) } label: { Label("Video on phone", systemImage: "video.fill") }.disabled(store.pending != nil)
                }
            }
            if store.pending != nil { ProgressView("Contacting phone") }
            if let message = store.message { Text(message).font(.caption).foregroundStyle(.secondary) }
            let candidates = query.isEmpty ? store.envelope.people : store.searchResults
            Section(query.isEmpty ? "Recent people" : "Results") {
                ForEach(candidates.filter { candidate in !selected.contains { $0.id == candidate.id } }) { person in
                    Button { if selected.count < 3 { selected.append(person) } } label: { Label(person.name, systemImage: "plus.circle") }.disabled(selected.count >= 3)
                }
                if !query.isEmpty && store.searchFinished && candidates.isEmpty { Text("No matching people").font(.caption) }
            }
            Text("Up to four people including you. Open DVNT on your phone to continue.").font(.caption2).foregroundStyle(.secondary)
        }.navigationTitle("Choose people").onChange(of: store.envelope.accountGen) { _, _ in selected = []; query = "" }.privacySensitive()
    }
}
