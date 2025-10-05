import SwiftUI
import SharedServices
import DesignSystem

public struct MessagesFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var conversations: [ConversationSummary] = []
    @State private var searchQuery: String = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let conversationsService: ConversationsService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(conversationsService: ConversationsService, capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.conversationsService = conversationsService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Search conversations", text: $searchQuery)
                        .textFieldStyle(.roundedBorder)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(designSystem.typography.callout)
                            .foregroundStyle(designSystem.colors.danger)
                    }
                }

                Section("Inbox") {
                    if isLoading && conversations.isEmpty {
                        ProgressView()
                            .frame(maxWidth: .infinity, alignment: .center)
                    } else if filteredConversations.isEmpty {
                        ContentUnavailableView("No Conversations", systemImage: "bubble.left", description: Text("Start a chat from a listing to see messages here."))
                    } else {
                        ForEach(filteredConversations) { conversation in
                            NavigationLink(value: conversation) {
                                ConversationRow(conversation: conversation)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
            .navigationDestination(for: ConversationSummary.self) { conversation in
                ConversationDetailView(
                    conversation: conversation,
                    service: conversationsService,
                    capabilityEmitter: capabilityEmitter
                )
            }
            .refreshable { await loadConversations(force: true) }
            .task { await loadConversations() }
        }
    }

    private var filteredConversations: [ConversationSummary] {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return conversations }
        return conversations.filter { conversation in
            conversation.title.localizedCaseInsensitiveContains(trimmed) ||
            conversation.lastMessagePreview.localizedCaseInsensitiveContains(trimmed)
        }
    }

    @MainActor
    private func loadConversations(force: Bool = false) async {
        if isLoading && !force { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let meta = SharedCoreRequestMeta(silent: true)
            conversations = try await conversationsService.fetchConversations(meta: meta)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            capabilityEmitter("haptic", ["style": "error"])
        }
    }
}

private struct ConversationRow: View {
    @Environment(\.designSystem) private var designSystem
    let conversation: ConversationSummary

    var body: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
            HStack(alignment: .firstTextBaseline) {
                Text(conversation.title)
                    .font(designSystem.typography.headline)
                Spacer()
                if let lastMessageAt = conversation.lastMessageAt {
                    Text(lastMessageAt, style: .time)
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Text(conversation.lastMessagePreview)
                .font(designSystem.typography.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            if conversation.unreadCount > 0 {
                Text("\(conversation.unreadCount) unread")
                    .font(designSystem.typography.footnote)
                    .foregroundStyle(designSystem.colors.accent)
                    .padding(.top, designSystem.spacing.xSmall)
            }
        }
        .padding(.vertical, designSystem.spacing.xSmall)
    }
}

private struct ConversationDetailView: View {
    @Environment(\.designSystem) private var designSystem
    let conversation: ConversationSummary
    let service: ConversationsService
    let capabilityEmitter: (String, [String: Any]) -> Void

    @State private var messages: [ConversationMessage] = []
    @State private var composeText: String = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if messages.isEmpty && !isLoading {
                ContentUnavailableView(
                    "No Messages",
                    systemImage: "bubble.left",
                    description: Text("Start the conversation to see messages here.")
                )
                .listRowSeparator(.hidden)
            } else {
                ForEach(messages) { message in
                    MessageRow(message: message)
                        .listRowInsets(EdgeInsets(top: designSystem.spacing.small, leading: 0, bottom: designSystem.spacing.small, trailing: 0))
                        .listRowSeparator(.hidden)
                }
            }
        }
        .listStyle(.plain)
        .safeAreaInset(edge: .bottom) {
            composer
                .background(.ultraThinMaterial)
        }
        .navigationTitle(conversation.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if isLoading { ProgressView() } }
        .task { await loadMessages() }
        .refreshable { await loadMessages(force: true) }
    }

    private var composer: some View {
        VStack(spacing: designSystem.spacing.xSmall) {
            if let errorMessage {
                Text(errorMessage)
                    .font(designSystem.typography.footnote)
                    .foregroundStyle(designSystem.colors.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .bottom, spacing: designSystem.spacing.small) {
                TextField("Message", text: $composeText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .font(designSystem.typography.body)

                Button(action: sendMessage) {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 18, weight: .semibold))
                }
                .disabled(composeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading)
                .buttonStyle(ListItPrimaryButtonStyle())
            }
        }
        .padding()
    }

    @MainActor
    private func loadMessages(force: Bool = false) async {
        if isLoading && !force { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let meta = SharedCoreRequestMeta(silent: true)
            messages = try await service.fetchMessages(id: conversation.id, meta: meta)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func sendMessage() {
        Task {
            let body = composeText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !body.isEmpty else { return }
            isLoading = true
            errorMessage = nil
            do {
                if let message = try await service.sendMessage(id: conversation.id, body: body) {
                    messages.append(message)
                    composeText = ""
                    capabilityEmitter("haptic", ["style": "success"])
                }
                await loadMessages(force: true)
            } catch {
                errorMessage = error.localizedDescription
                capabilityEmitter("haptic", ["style": "error"])
            }
            isLoading = false
        }
    }
}

private struct MessageRow: View {
    @Environment(\.designSystem) private var designSystem
    let message: ConversationMessage

    var body: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
            HStack(alignment: .firstTextBaseline) {
                Text(message.senderName)
                    .font(designSystem.typography.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                if let sentAt = message.sentAt {
                    Text(sentAt, style: .relative)
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if !message.body.isEmpty {
                Text(message.body)
                    .font(designSystem.typography.body)
                    .foregroundStyle(designSystem.colors.onSurface)
            }

            if !message.attachmentURLs.isEmpty {
                VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                    ForEach(message.attachmentURLs, id: \.self) { url in
                        Link(destination: url) {
                            Label(url.lastPathComponent, systemImage: "paperclip")
                                .font(designSystem.typography.footnote)
                        }
                    }
                }
            }
        }
        .padding()
        .background(designSystem.colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.medium))
        .shadow(color: designSystem.colors.surface.opacity(0.05), radius: 4, x: 0, y: 2)
    }
}
