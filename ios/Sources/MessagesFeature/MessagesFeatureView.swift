import SwiftUI
import DesignSystem
import SharedServices
import UIKit

public struct MessagesFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var conversations: [ConversationSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let messagesService: any MessagesServiceProviding
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(messagesService: any MessagesServiceProviding,
                capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.messagesService = messagesService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            List {
                Section("Inbox") {
                    if isLoading && conversations.isEmpty {
                        HStack {
                            Spacer()
                            ProgressView("Loading conversations…")
                                .progressViewStyle(.circular)
                            Spacer()
                        }
                    } else if let errorMessage, conversations.isEmpty {
                        ContentUnavailableView(
                            "Unable to load",
                            systemImage: "exclamationmark.triangle",
                            description: Text(errorMessage)
                        )
                    } else if conversations.isEmpty {
                        ContentUnavailableView(
                            "No conversations yet",
                            systemImage: "bubble.left.and.bubble.right",
                            description: Text("Start chatting with buyers from your listings to see threads here.")
                        )
                    } else {
                        ForEach(conversations) { conversation in
                            NavigationLink {
                                ThreadDetailView(
                                    conversation: conversation,
                                    messagesService: messagesService,
                                    capabilityEmitter: capabilityEmitter,
                                    markConversationRead: { id in markConversationAsRead(id) },
                                    handleUpdatedConversation: { updated in updateConversation(updated) },
                                    handleConversationDeletion: { removed in removeConversation(removed) }
                                )
                            } label: {
                                ThreadRow(conversation: conversation)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await delete(conversation) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await loadConversations(force: true) }
            .task { await loadConversations(force: false) }
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(errorMessage ?? "")
        }
    }
}

private extension MessagesFeatureView {
    @MainActor
    func loadConversations(force: Bool) async {
        if isLoading && !force { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let items = try await messagesService.fetchConversations()
            conversations = MessagesFeatureView.sortConversations(items)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    func delete(_ conversation: ConversationSummary) async {
        do {
            try await messagesService.deleteConversation(conversationID: conversation.id)
            removeConversation(conversation)
            capabilityEmitter("haptic", ["style": "warning"])
        } catch {
            errorMessage = error.localizedDescription
            capabilityEmitter("haptic", ["style": "error"])
        }
    }

    func markConversationAsRead(_ id: String) {
        guard let index = conversations.firstIndex(where: { $0.id == id }) else { return }
        conversations[index] = conversations[index].markingRead()
        sortInPlace()
    }

    func updateConversation(_ conversation: ConversationSummary) {
        if let index = conversations.firstIndex(where: { $0.id == conversation.id }) {
            conversations[index] = conversation
        } else {
            conversations.append(conversation)
        }
        sortInPlace()
    }

    func removeConversation(_ conversation: ConversationSummary) {
        conversations.removeAll { $0.id == conversation.id }
    }

    func sortInPlace() {
        conversations = MessagesFeatureView.sortConversations(conversations)
    }

    static func sortConversations(_ conversations: [ConversationSummary]) -> [ConversationSummary] {
        conversations.sorted { lhs, rhs in
            if lhs.isUnread != rhs.isUnread {
                return lhs.isUnread && !rhs.isUnread
            }
            let lhsDate = lhs.lastMessageDate ?? Date.distantPast
            let rhsDate = rhs.lastMessageDate ?? Date.distantPast
            return lhsDate > rhsDate
        }
    }
}

private struct ThreadRow: View {
    @Environment(\.designSystem) private var designSystem
    let conversation: ConversationSummary

    private var timeText: String {
        guard let date = conversation.lastMessageDate else { return "" }
        return RelativeDateTimeFormatter.messages.localizedString(for: date, relativeTo: Date())
    }

    var body: some View {
        HStack(alignment: .top, spacing: designSystem.spacing.medium) {
            Circle()
                .fill(conversation.isUnread ? designSystem.colors.accent : designSystem.colors.secondary.opacity(0.3))
                .frame(width: 12, height: 12)
                .padding(.top, designSystem.spacing.xSmall)

            VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                Text(conversation.otherUserName)
                    .font(designSystem.typography.headline)
                if let listingTitle = conversation.listingTitle, !listingTitle.isEmpty {
                    Text(listingTitle)
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                }
                if !conversation.lastMessageBody.isEmpty {
                    Text(conversation.lastMessageBody)
                        .font(designSystem.typography.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                } else {
                    Text("No messages yet")
                        .font(designSystem.typography.callout)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: designSystem.spacing.xSmall) {
                Text(timeText)
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
                if conversation.isUnread {
                    Text("New")
                        .font(designSystem.typography.caption)
                        .padding(.horizontal, designSystem.spacing.small)
                        .padding(.vertical, designSystem.spacing.xSmall)
                        .background(designSystem.colors.primary.opacity(0.15))
                        .clipShape(Capsule())
                }
            }
        }
        .padding(.vertical, designSystem.spacing.small)
    }
}

private struct ThreadDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.designSystem) private var designSystem

    @State private var conversation: ConversationSummary
    @State private var messages: [ConversationMessage] = []
    @State private var draft: String = ""
    @State private var isLoading = false
    @State private var isSending = false
    @State private var loadError: String?
    @State private var sendError: String?
    @State private var warningMessage: String?
    @State private var showingDeleteConfirmation = false

    private let messagesService: any MessagesServiceProviding
    private let capabilityEmitter: (String, [String: Any]) -> Void
    private let markConversationRead: (String) -> Void
    private let handleUpdatedConversation: (ConversationSummary) -> Void
    private let handleConversationDeletion: (ConversationSummary) -> Void

    init(conversation: ConversationSummary,
         messagesService: any MessagesServiceProviding,
         capabilityEmitter: @escaping (String, [String: Any]) -> Void,
         markConversationRead: @escaping (String) -> Void,
         handleUpdatedConversation: @escaping (ConversationSummary) -> Void,
         handleConversationDeletion: @escaping (ConversationSummary) -> Void) {
        self._conversation = State(initialValue: conversation)
        self.messagesService = messagesService
        self.capabilityEmitter = capabilityEmitter
        self.markConversationRead = markConversationRead
        self.handleUpdatedConversation = handleUpdatedConversation
        self.handleConversationDeletion = handleConversationDeletion
    }

    var body: some View {
        VStack(spacing: designSystem.spacing.medium) {
            ScrollViewReader { proxy in
                ScrollView {
                    if isLoading && messages.isEmpty {
                        VStack {
                            Spacer(minLength: designSystem.spacing.large)
                            ProgressView("Loading messages…")
                                .progressViewStyle(.circular)
                                .frame(maxWidth: .infinity)
                            Spacer(minLength: designSystem.spacing.large)
                        }
                    } else if let loadError, messages.isEmpty {
                        ContentUnavailableView(
                            "Unable to load",
                            systemImage: "exclamationmark.triangle",
                            description: Text(loadError)
                        )
                        .padding(designSystem.spacing.large)
                    } else if messages.isEmpty {
                        ContentUnavailableView(
                            "No messages yet",
                            systemImage: "ellipsis.bubble",
                            description: Text("Start the conversation with a friendly hello.")
                        )
                        .padding(designSystem.spacing.large)
                    } else {
                        LazyVStack(alignment: .leading, spacing: designSystem.spacing.medium) {
                            ForEach(messages) { message in
                                MessageBubble(
                                    message: message,
                                    otherUserName: conversation.otherUserName,
                                    isFromCurrentUser: message.senderID != conversation.otherUserID,
                                    designSystem: designSystem
                                )
                                .id(message.id)
                            }
                        }
                        .padding(designSystem.spacing.large)
                    }
                }
                .background(designSystem.colors.background)
                .refreshable { await loadMessages(force: true) }
                .onChange(of: messages) { _, newMessages in
                    guard let last = newMessages.last else { return }
                    DispatchQueue.main.async {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            if let warningMessage {
                Text(warningMessage)
                    .font(designSystem.typography.footnote)
                    .foregroundStyle(designSystem.colors.warning)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, designSystem.spacing.large)
            }

            composer
        }
        .background(designSystem.colors.background.ignoresSafeArea())
        .navigationTitle(conversation.otherUserName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) {
                        showingDeleteConfirmation = true
                    } label: {
                        Label("Delete Conversation", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .confirmationDialog(
            "Delete this conversation?",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { await deleteConversation() }
            }
            Button("Cancel", role: .cancel) { }
        }
        .task { await loadMessages(force: false) }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            if let sendError {
                Text(sendError)
                    .font(designSystem.typography.footnote)
                    .foregroundStyle(designSystem.colors.danger)
            }

            HStack(alignment: .bottom, spacing: designSystem.spacing.small) {
                TextField("Message", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isSending)

                Button(isSending ? "Sending…" : "Send") {
                    sendMessage()
                }
                .buttonStyle(ListItPrimaryButtonStyle())
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
            }
        }
        .padding(designSystem.spacing.large)
        .background(designSystem.colors.surface.ignoresSafeArea())
    }
}

private extension ThreadDetailView {
    @MainActor
    func loadMessages(force: Bool) async {
        if isLoading && !force { return }
        isLoading = true
        loadError = nil
        do {
            let fetched = try await messagesService.fetchMessages(conversationID: conversation.id)
            messages = fetched
            if let last = fetched.last {
                conversation = conversation.updatingLastMessage(with: last).markingRead()
            } else {
                conversation = conversation.markingRead()
            }
            markConversationRead(conversation.id)
            handleUpdatedConversation(conversation)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    func sendMessage() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        sendError = nil
        warningMessage = nil
        isSending = true
        Task {
            do {
                let result = try await messagesService.sendMessage(conversationID: conversation.id, body: trimmed)
                await MainActor.run {
                    draft = ""
                    messages.append(result.message)
                    conversation = conversation.updatingLastMessage(with: result.message).markingRead()
                    handleUpdatedConversation(conversation)
                    markConversationRead(conversation.id)
                    if result.otherUserDeleted {
                        warningMessage = "Heads up: the other participant previously deleted this conversation. They may not see new replies." 
                    }
                    capabilityEmitter("haptic", ["style": "success"])
                }
            } catch MessagesServiceError.emptyMessage {
                await MainActor.run {
                    capabilityEmitter("haptic", ["style": "impact.light"])
                }
            } catch {
                await MainActor.run {
                    sendError = error.localizedDescription
                    capabilityEmitter("haptic", ["style": "error"])
                }
            }
            await MainActor.run { isSending = false }
        }
    }

    @MainActor
    func deleteConversation() async {
        do {
            try await messagesService.deleteConversation(conversationID: conversation.id)
            capabilityEmitter("haptic", ["style": "warning"])
            handleConversationDeletion(conversation)
            dismiss()
        } catch {
            sendError = error.localizedDescription
            capabilityEmitter("haptic", ["style": "error"])
        }
    }
}

private struct MessageBubble: View {
    let message: ConversationMessage
    let otherUserName: String
    let isFromCurrentUser: Bool
    let designSystem: DesignSystemTheme

    private var timestampText: String {
        guard let date = message.sentAt else { return "" }
        return DateFormatter.messagesTimestamp.string(from: date)
    }

    var body: some View {
        VStack(alignment: isFromCurrentUser ? .trailing : .leading, spacing: designSystem.spacing.xSmall) {
            VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                if !message.body.isEmpty {
                    Text(message.body)
                        .font(designSystem.typography.body)
                } else {
                    Text(isFromCurrentUser ? "You sent an attachment" : "\(otherUserName) sent an attachment")
                        .font(designSystem.typography.body)
                }

                if !message.images.isEmpty {
                    AttachmentGallery(imageSources: message.images)
                }
            }
            .padding(.vertical, designSystem.spacing.small)
            .padding(.horizontal, designSystem.spacing.medium)
            .background(isFromCurrentUser ? designSystem.colors.primary : designSystem.colors.surface)
            .foregroundStyle(isFromCurrentUser ? designSystem.colors.onPrimary : designSystem.colors.onSurface)
            .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous))

            if !timestampText.isEmpty {
                Text(timestampText)
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: isFromCurrentUser ? .trailing : .leading)
    }
}

private struct AttachmentGallery: View {
    let imageSources: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(imageSources, id: \.self) { source in
                    AttachmentThumbnail(source: source)
                }
            }
        }
    }
}

private struct AttachmentThumbnail: View {
    let source: String

    var body: some View {
        Group {
            if let url = URL(string: source), url.scheme?.hasPrefix("http") == true {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        placeholder
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        placeholder
                    @unknown default:
                        placeholder
                    }
                }
            } else if let image = AttachmentThumbnail.imageFromDataURL(source) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder
            }
        }
        .frame(width: 96, height: 96)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var placeholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(uiColor: .secondarySystemBackground))
            Image(systemName: "photo")
                .foregroundStyle(.secondary)
        }
    }

    private static func imageFromDataURL(_ string: String) -> UIImage? {
        guard string.lowercased().hasPrefix("data:image"),
              let commaIndex = string.firstIndex(of: ",") else { return nil }
        let base64Start = string.index(after: commaIndex)
        let base64String = String(string[base64Start...])
        guard let data = Data(base64Encoded: base64String) else { return nil }
        return UIImage(data: data)
    }
}

private extension RelativeDateTimeFormatter {
    static let messages: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()
}

private extension DateFormatter {
    static let messagesTimestamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()
}

#if DEBUG
private final class PreviewMessagesService: MessagesServiceProviding {
    func fetchConversations() async throws -> [ConversationSummary] {
        let recent = ConversationSummary(
            id: "42",
            listingID: "101",
            listingTitle: "Vintage Camera",
            listingOwnerID: "12",
            coverImage: nil,
            otherUserID: "7",
            otherUserName: "Alex",
            lastMessageID: "5",
            lastMessageBody: "Looking forward to picking it up tonight!",
            lastMessageDate: Date().addingTimeInterval(-60 * 15),
            lastMessageSenderID: "7",
            lastMessageIsAdmin: false,
            isUnread: true,
            otherUserDeleted: false
        )

        let older = ConversationSummary(
            id: "18",
            listingID: nil,
            listingTitle: nil,
            listingOwnerID: nil,
            coverImage: nil,
            otherUserID: "99",
            otherUserName: "Support",
            lastMessageID: "3",
            lastMessageBody: "We resolved the issue on your account.",
            lastMessageDate: Date().addingTimeInterval(-60 * 60 * 12),
            lastMessageSenderID: "1",
            lastMessageIsAdmin: true,
            isUnread: false,
            otherUserDeleted: false
        )

        return [recent, older]
    }

    func fetchMessages(conversationID: String) async throws -> [ConversationMessage] {
        [
            ConversationMessage(
                id: "1",
                body: "Hi! Is the camera still available?",
                senderID: "7",
                senderName: "Alex",
                sentAt: Date().addingTimeInterval(-60 * 30),
                images: [],
                isFromAdmin: false
            ),
            ConversationMessage(
                id: "2",
                body: "Yep! I can meet downtown after 5.",
                senderID: "1",
                senderName: "You",
                sentAt: Date().addingTimeInterval(-60 * 20),
                images: [],
                isFromAdmin: false
            ),
            ConversationMessage(
                id: "3",
                body: "Great, see you at the coffee shop",
                senderID: "7",
                senderName: "Alex",
                sentAt: Date().addingTimeInterval(-60 * 5),
                images: ["https://picsum.photos/seed/preview/200"],
                isFromAdmin: false
            )
        ]
    }

    func sendMessage(conversationID: String, body: String) async throws -> SendMessageResult {
        let message = ConversationMessage(
            id: UUID().uuidString,
            body: body,
            senderID: "1",
            senderName: "You",
            sentAt: Date(),
            images: [],
            isFromAdmin: false
        )
        return SendMessageResult(message: message, otherUserDeleted: false)
    }

    func deleteConversation(conversationID: String) async throws { }
}

struct MessagesFeatureView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            MessagesFeatureView(messagesService: PreviewMessagesService())
                .environment(\.designSystem, DesignSystemTheme())
        }
    }
}
#endif
