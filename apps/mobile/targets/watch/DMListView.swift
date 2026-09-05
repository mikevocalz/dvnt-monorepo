import SwiftUI
import WatchKit

/// Conversation rows shared with the root Inbox. Thread data resolves by ID.
struct DMListView: View {
    @Environment(DMStore.self) private var dms
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    var body: some View {
        Group {
            if dms.isEmpty {
                EmptyDMsView(reachable: connectivity.isReachable)
            } else {
                List {
                    ForEach(dms.dms) { dm in
                        NavigationLink {
                            DMDetailView(dm: dm)
                        } label: {
                            DMRow(dm: dm)
                        }
                        .listRowBackground(
                            RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
                                .fill(dm.unread ? DVNT.hairline : DVNT.Surface.low)
                        )
                    }
                }
                .listStyle(.carousel)
            }
        }
        .navigationTitle("Messages")
        .containerBackground(DVNT.canvas, for: .navigation)
    }
}

/// Rounded-square identity; absent artwork retains the person/group glyph.
private struct DMAvatar: View {
    let dm: WatchDM

    private let size: CGFloat = 28

    var body: some View {
        if let url = dm.avatarURL?.trimmingCharacters(in: .whitespacesAndNewlines),
           !url.isEmpty {
            // Rounded square, not a disc. `size / 2` made this a circle, which
            // contradicts the rule AvatarMosaic states outright — rounded
            // SQUARES, never circles — and meant the same person appeared as a
            // dot in a row and a square in the Messages mosaic. Radius.chip
            // matches the broadcast row's event thumb beside it, so every piece
            // of art in this inbox now has one shape.
            EventArt(
                dominantHex: nil,
                imageURL: url,
                cornerRadius: DVNT.Radius.chip
            )
            .frame(width: size, height: size)
            // Same reason as the broadcast thumb: the frame alone does not
            // clip a scaledToFill image.
            .clipShape(
                RoundedRectangle(cornerRadius: DVNT.Radius.chip, style: .continuous)
            )
        } else {
            Image(systemName: dm.isGroup ? "person.2.fill" : "person.fill")
                .font(.system(size: DVNT.TypeScale.Icon.inline))
                .foregroundStyle(dm.unread ? DVNT.accent : DVNT.textFaint)
                .frame(width: size)
        }
    }
}

/// Internal rather than private: the unified inbox in `EventListView` composes
/// this row alongside `BroadcastRow`, so one conversation looks identical
/// whether it is reached from the inbox or from this standalone list.
struct DMRow: View {
    let dm: WatchDM

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.tight) {
            HStack(spacing: DVNT.Space.snug) {
                DMAvatar(dm: dm)
                Text(dm.name)
                    .font(DVNT.TypeScale.title(18))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Spacer(minLength: DVNT.Space.tight)
                if dm.unread {
                    Circle().fill(DVNT.accent).frame(width: 6, height: 6)
                }
            }
            if let media = dm.attachments.first {
                HStack {
                    Image(systemName: media.kind == "video" ? "video" : "photo")
                    if media.thumbURL != nil { WatchMediaThumbnail(attachment: media, presentation: .row) }
                    Text("\(dm.attachments.count) attachment\(dm.attachments.count == 1 ? "" : "s")").font(DVNT.TypeScale.caption())
                }.foregroundStyle(DVNT.textDim)
            }
            if !dm.preview.isEmpty {
                Text(dm.preview)
                    .font(DVNT.TypeScale.body())
                    .foregroundColor(DVNT.textDim)
                    .lineLimit(2)
            }
            if let date = dm.date {
                Text(date.formatted(.relative(presentation: .named)))
                    .font(DVNT.TypeScale.caption(13))
                    .foregroundColor(DVNT.textFaint)
            }
        }
        .padding(.vertical, DVNT.Space.hair)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(dm.unread
            ? "\(dm.name), unread. \(dm.preview)"
            : "\(dm.name). \(dm.preview)")
    }
}

/// PLATFORM BEHAVIOR: live pages resolve by conversation ID; inserts never move
/// a reader away from an older message. The wearer explicitly follows New.
/// NOT in this view: delivery truth or transport retries; DMStore owns both.
/// STOP-THE-LINE CHECKS: retain anchors, draft, tapped attachment and account scope.
struct DMDetailView: View {
    let conversationId: String
    init(dm: WatchDM) { conversationId = dm.id }
    @Environment(DMStore.self) private var store
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var visibleMessage: String?
    @State private var viewer: WatchAttachment?
    @State private var viewerAttachments: [WatchAttachment] = []
    @Environment(\.scenePhase) private var scenePhase
    @State private var reactingTo: WatchMessage?
    @State private var showReactions = false
    @State private var showQuickReplies = false
    @State private var hasNewMessages = false
    @State private var positionedInitialPage = false
    private var dm: WatchDM? { store.dms.first { $0.id == conversationId } }
    private var page: WatchThreadPage? { store.pages[conversationId] }
    private var messages: [WatchMessage] { page?.messages ?? [] }

    var body: some View {
        Group {
            if dm == nil {
                ContentUnavailableView("Conversation unavailable", systemImage: "message")
            } else if dimmed {
                Label("Raise to read messages", systemImage: "message")
            } else {
                GeometryReader { viewport in
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: DVNT.Space.base) {
                                if page?.olderCursor != nil {
                                    Button("Load older") { store.requestThread(conversationId, older: true) }
                                }
                                if store.loading.contains(conversationId) { ProgressView("Loading messages") }
                                if let error = store.errors[conversationId] {
                                    Text(error).font(DVNT.TypeScale.body())
                                    Button("Retry") { store.requestThread(conversationId) }
                                }
                                if let page, page.messages.isEmpty {
                                    Text("Say hi to \(dm?.name ?? "them")").font(DVNT.TypeScale.body())
                                }
                                ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                                    if startsDay(at: index), let date = TicketStore.parseDate(message.createdAt) {
                                        Text(date.formatted(date: .abbreviated, time: .omitted))
                                            .font(DVNT.TypeScale.caption())
                                            .foregroundStyle(DVNT.textBright)
                                            .accessibilityAddTraits(.isHeader)
                                    }
                                    ThreadMessageBubble(message: message, isGroup: dm?.isGroup == true) { attachment in
                                        viewerAttachments = message.attachments.filter { $0.kind == "image" }
                                        viewer = attachment
                                    } refresh: {
                                        store.requestThread(conversationId)
                                    }
                                    .id(message.id)
                                    .background {
                                        if message.id == messages.last?.id {
                                            GeometryReader { geometry in
                                                let frame = geometry.frame(in: .named("conversation-scroll"))
                                                Color.clear.preference(key: LatestMessageVisible.self,
                                                    value: frame.maxY > 0 && frame.maxY <= viewport.size.height)
                                            }
                                        }
                                    }
                                    Button("React") { reactingTo = message; showReactions = true }
                                        .font(DVNT.TypeScale.caption())
                                        .accessibilityLabel("React to message from \(message.senderName ?? "member")")
                                }
                                outbox
                                composer
                            }
                            .scrollTargetLayout()
                            .padding(.horizontal, DVNT.Space.snug)
                            .padding(.bottom, DVNT.Space.roomy)
                        }
                        .coordinateSpace(name: "conversation-scroll")
                        .scrollPosition(id: $visibleMessage, anchor: .top)
                        .onPreferenceChange(LatestMessageVisible.self) { visible in
                            if visible { hasNewMessages = false }
                        }
                        .overlay(alignment: .bottom) {
                            if hasNewMessages, let latest = messages.last?.id {
                                Button {
                                    proxy.scrollTo(latest, anchor: .bottom)
                                    hasNewMessages = false
                                } label: {
                                    Label("New", systemImage: "arrow.down")
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(DVNT.accent)
                                .accessibilityLabel("Read new messages")
                            }
                        }
                        .onAppear {
                            if let anchor = store.anchors[conversationId] {
                                visibleMessage = anchor
                                positionedInitialPage = true
                            } else if let latest = messages.last?.id {
                                visibleMessage = latest
                                positionedInitialPage = true
                            }
                            store.requestThread(conversationId)
                        }
                        .onChange(of: visibleMessage) { _, id in
                            if positionedInitialPage, let id { store.anchors[conversationId] = id }
                        }
                        .onChange(of: messages.last?.id) { old, id in
                            guard let id else { return }
                            if !positionedInitialPage {
                                visibleMessage = id
                                positionedInitialPage = true
                            } else if old != nil && old != id {
                                hasNewMessages = true
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(dm?.name ?? "Conversation unavailable")
        .background(DVNT.canvas)
        .sheet(item: $viewer) { selected in
            WatchMediaViewer(attachments: viewerAttachments, selectedId: selected.id, conversationId: conversationId)
        }
        .confirmationDialog("React", isPresented: $showReactions) {
            if let message = reactingTo {
                ForEach(["😂", "😢", "😊", "😈", "🥵", "💝", "❤️"], id: \.self) { emoji in
                    let mine = message.reactions?.first(where: { $0.emoji == emoji })?.mine == true
                    Button("\(mine ? "Remove " : "")\(emoji)") {
                        store.performThreadAction(conversationId, messageId: message.id, emoji: emoji, desiredPresent: !mine)
                    }
                }
            }
        }
        .onChange(of: dm?.lastMessageId) { _, _ in store.requestThread(conversationId) }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.requestThread(conversationId) }
        }
        .confirmationDialog("Quick replies", isPresented: $showQuickReplies) {
            ForEach(store.envelope.quickReplies, id: \.self) { reply in
                Button(reply) { store.drafts[conversationId] = reply }
            }
        }
        .onChange(of: dm == nil) { _, unavailable in
            if unavailable {
                viewer = nil; viewerAttachments = []; reactingTo = nil
                showReactions = false; showQuickReplies = false
            }
        }
        .onChange(of: store.envelope.accountGen) { _, _ in
            viewer = nil
            reactingTo = nil
            showReactions = false
            showQuickReplies = false
            viewerAttachments = []
            visibleMessage = nil
            hasNewMessages = false
            positionedInitialPage = false
        }
    }

    @ViewBuilder private var outbox: some View {
        ForEach(store.outbox.filter { item in
            item.command.conversationId == conversationId &&
                !messages.contains { $0.id == item.serverId }
        }) { item in
            VStack(alignment: .leading, spacing: DVNT.Space.snug) {
                Text(item.command.text).font(DVNT.TypeScale.body())
                Text(item.state == "sending" ? "Sending…" : item.state.capitalized)
                    .font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textBright)
                if let error = item.error { Text(error).font(DVNT.TypeScale.caption()) }
                if item.state == "failed" { Button("Retry") { store.retry(item.id) } }
                if item.state == "queued" { Button("Cancel") { store.cancel(item.id) } }
            }
            .padding(DVNT.Space.base)
            .privacySensitive()
        }
    }

    @ViewBuilder private var composer: some View {
        if store.envelope.protocol == 2 {
            Button("Mark read") { store.performThreadAction(conversationId) }
                .disabled(store.actionStatus[conversationId] == "Updating…")
            if let status = store.actionStatus[conversationId] {
                Text(status).font(DVNT.TypeScale.caption())
                if store.threadActions[conversationId] != nil && status != "Updating…" {
                    Button("Retry update") { store.retryThreadAction(conversationId) }
                    Button("Cancel pending update") { store.cancelThreadAction(conversationId) }
                }
            }
            TextFieldLink("Reply") { text in store.drafts[conversationId] = text }
                .tint(DVNT.accent)
            if let draft = store.drafts[conversationId], !draft.isEmpty {
                Text(draft).font(DVNT.TypeScale.body()).privacySensitive()
                Button("Send") { store.send(conversationId: conversationId, text: draft) }
                Button("Discard draft", role: .destructive) { store.drafts[conversationId] = nil }
            }
            if !store.envelope.quickReplies.isEmpty {
                Button("Quick replies") { showQuickReplies = true }
            }
        } else {
            Text("Open the updated DVNT app on iPhone to load this conversation.")
                .font(DVNT.TypeScale.body())
        }
    }

    private func startsDay(at index: Int) -> Bool {
        guard index > 0 else { return true }
        guard let previous = TicketStore.parseDate(messages[index - 1].createdAt),
              let current = TicketStore.parseDate(messages[index].createdAt) else { return false }
        return !Calendar.current.isDate(previous, inSameDayAs: current)
    }
}

private struct LatestMessageVisible: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

private struct ThreadMessageBubble: View {
    let message: WatchMessage
    let isGroup: Bool
    let openImage: (WatchAttachment) -> Void
    let refresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.snug) {
            if isGroup && !message.outgoing {
                Text(message.senderName ?? "Group member")
                    .font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textBright)
            }
            ForEach(message.attachments) { attachment in
                if attachment.kind == "image" {
                    WatchMediaThumbnail(attachment: attachment, onOpen: { openImage(attachment) }, onRetry: refresh)
                } else {
                    if attachment.thumbURL != nil { WatchMediaThumbnail(attachment: attachment) }
                    Label("Video · Watch on iPhone", systemImage: "video")
                        .font(DVNT.TypeScale.body())
                }
            }
            if !message.text.isEmpty { Text(message.text).font(DVNT.TypeScale.body()) }
            if let reactions = message.reactions, !reactions.isEmpty {
                Text(reactions.filter { $0.count > 0 }.map { "\($0.emoji) \($0.count)\($0.mine ? " · You" : "")" }.joined(separator: "  "))
                    .font(DVNT.TypeScale.caption())
            }
        }
        .padding(DVNT.Space.base)
        .frame(maxWidth: .infinity, alignment: message.outgoing ? .trailing : .leading)
        .background(DVNT.Surface.low, in: RoundedRectangle(cornerRadius: DVNT.Radius.card))
        .privacySensitive()
    }
}

struct WatchMediaThumbnail: View {
    enum Presentation { case row, thread, viewer }
    let attachment: WatchAttachment
    var presentation: Presentation = .thread
    var onOpen: (() -> Void)?
    var onRetry: (() -> Void)?
    var imageScale: CGFloat = 1
    @Environment(DMStore.self) private var store
    @State private var image: CGImage?
    @State private var failure: String?
    @State private var retry = 0

    private var url: String? {
        presentation == .viewer ? (attachment.fullURL ?? attachment.thumbURL) : attachment.thumbURL
    }
    private var maximumPixels: Int {
        switch presentation { case .row: return 64; case .thread: return 256; case .viewer: return 512 }
    }
    private var requestID: String { "\(store.envelope.accountGen)|\(url ?? "")|\(retry)|\(maximumPixels)" }

    var body: some View {
        Group {
            switch presentation {
            case .row: content.frame(width: 24, height: 24)
            case .thread: content.frame(minHeight: 64, maxHeight: 160)
            case .viewer: content.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: DVNT.Radius.control))
        .task(id: requestID) {
            image = nil
            failure = nil
            do {
                let loaded = try await WatchMediaCache.shared.image(url: url,
                    accountGen: store.envelope.accountGen, maximumPixels: maximumPixels)
                try Task.checkCancellation()
                image = loaded
            } catch is CancellationError {
            } catch {
                if !Task.isCancelled {
                    failure = (error as? WatchMediaCache.Failure)?.errorDescription
                        ?? "Image could not load. Check the connection and retry."
                }
            }
        }
        .onDisappear { image = nil }
    }

    @ViewBuilder private var content: some View {
        if let image {
            if let onOpen {
                Button(action: onOpen) { rendered(image) }.buttonStyle(.plain)
                    .accessibilityLabel(attachment.alt ?? "Open photo")
            } else {
                rendered(image).accessibilityLabel(attachment.alt ?? "Photo")
            }
        } else if presentation == .row {
            Image(systemName: "photo").accessibilityHidden(true)
        } else if let failure {
            VStack(spacing: DVNT.Space.tight) {
                Text(failure).font(DVNT.TypeScale.caption())
                Button("Retry image") { retry += 1; onRetry?() }
            }
        } else {
            ProgressView("Loading image").font(DVNT.TypeScale.caption())
        }
    }

    private func rendered(_ image: CGImage) -> some View {
        Image(decorative: image, scale: 1)
            .resizable().scaledToFit().scaleEffect(imageScale)
    }
}

struct WatchMediaViewer: View {
    let attachments: [WatchAttachment]
    let conversationId: String
    @Environment(DMStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var selectedId: String
    @State private var zoom = 1.0

    init(attachments: [WatchAttachment], selectedId: String, conversationId: String) {
        self.conversationId = conversationId
        self.attachments = attachments
        _selectedId = State(initialValue: selectedId)
    }

    private var currentAttachments: [WatchAttachment] {
        let current = store.pages[conversationId]?.messages.flatMap(\.attachments) ?? []
        return attachments.compactMap { original in current.first { $0.id == original.id } }
    }

    var body: some View {
        NavigationStack {
            Group {
                if !currentAttachments.contains(where: { $0.id == selectedId }) {
                    ContentUnavailableView("Photo unavailable", systemImage: "photo")
                } else if dimmed {
                    Label("Raise to view photo", systemImage: "photo")
                } else {
                    VStack {
                        TabView(selection: $selectedId) {
                            ForEach(currentAttachments) { attachment in
                                WatchMediaThumbnail(attachment: attachment, presentation: .viewer,
                                    onRetry: { store.requestThread(conversationId) }, imageScale: CGFloat(zoom))
                                    .tag(attachment.id)
                            }
                        }
                        .tabViewStyle(.page)
                        .clipped()
                        HStack {
                            Button("−") { zoom = max(1, zoom - 0.5) }
                                .accessibilityLabel("Zoom out")
                            Button("+") { zoom = min(3, zoom + 0.5) }
                                .accessibilityLabel("Zoom in")
                        }
                    }
                    .focusable()
                    .digitalCrownRotation($zoom, from: 1, through: 3, by: 0.1,
                        sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: false)
                }
            }
            .navigationTitle(currentAttachments.isEmpty ? "Photo" : "\((currentAttachments.firstIndex { $0.id == selectedId } ?? 0) + 1) of \(currentAttachments.count)")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
        }
        .onChange(of: selectedId) { _, _ in zoom = 1 }
        .privacySensitive()
    }
}

private struct EmptyDMsView: View {
    let reachable: Bool
    var body: some View {
        ZStack {
            DVNT.canvas.ignoresSafeArea()
            VStack(spacing: DVNT.Space.base) {
                Image(systemName: "message")
                    .font(.system(size: DVNT.TypeScale.Icon.hero))
                    .foregroundColor(DVNT.accent)
                Text("No messages")
                    .font(DVNT.TypeScale.title())
                    .foregroundColor(.white)
                Text(reachable ? "Conversations appear here."
                               : "Open DVNT on your iPhone to sync.")
                    .font(DVNT.TypeScale.body())
                    .foregroundColor(DVNT.textDim)
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
    }
}
