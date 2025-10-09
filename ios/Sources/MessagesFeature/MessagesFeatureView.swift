import SwiftUI
import DesignSystem

public struct MessagesFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var threads: [MessageThread] = MessageThread.samples
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            List {
                Section("Inbox") {
                    ForEach(threads) { thread in
                        NavigationLink(value: thread) {
                            ThreadRow(thread: thread)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                delete(thread)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
            .navigationDestination(for: MessageThread.self) { thread in
                ThreadDetailView(thread: thread, capabilityEmitter: capabilityEmitter)
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
        }
    }

    private func delete(_ thread: MessageThread) {
        withAnimation {
            threads.removeAll { $0.id == thread.id }
            capabilityEmitter("haptic", ["style": "warning"])
        }
    }
}

private struct ThreadRow: View {
    @Environment(\.designSystem) private var designSystem
    let thread: MessageThread

    var body: some View {
        HStack(alignment: .top, spacing: designSystem.spacing.medium) {
            Circle()
                .fill(thread.isUnread ? designSystem.colors.accent : designSystem.colors.secondary.opacity(0.3))
                .frame(width: 12, height: 12)
                .padding(.top, designSystem.spacing.xSmall)

            VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                Text(thread.participant)
                    .font(designSystem.typography.headline)
                Text(thread.preview)
                    .font(designSystem.typography.callout)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: designSystem.spacing.xSmall) {
                Text(thread.time)
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
                if thread.isUnread {
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
    @Environment(\.designSystem) private var designSystem
    @State private var draft: String = ""
    let thread: MessageThread
    let capabilityEmitter: (String, [String: Any]) -> Void

    var body: some View {
        VStack(spacing: designSystem.spacing.medium) {
            ScrollView {
                VStack(alignment: .leading, spacing: designSystem.spacing.medium) {
                    ForEach(thread.messages) { message in
                        MessageBubble(message: message)
                    }
                }
                .padding(designSystem.spacing.large)
            }
            .background(designSystem.colors.background)

            HStack {
                TextField("Message", text: $draft)
                    .textFieldStyle(.roundedBorder)
                Button("Send") {
                    draft = ""
                    capabilityEmitter("haptic", ["style": "success"])
                }
                .buttonStyle(ListItPrimaryButtonStyle())
                .disabled(draft.isEmpty)
            }
            .padding(designSystem.spacing.large)
            .background(designSystem.colors.surface.ignoresSafeArea())
        }
        .navigationTitle(thread.participant)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct MessageBubble: View {
    @Environment(\.designSystem) private var designSystem
    let message: Message

    var body: some View {
        VStack(alignment: message.isFromCurrentUser ? .trailing : .leading, spacing: designSystem.spacing.xSmall) {
            Text(message.body)
                .padding(.vertical, designSystem.spacing.small)
                .padding(.horizontal, designSystem.spacing.medium)
                .background(message.isFromCurrentUser ? designSystem.colors.primary : designSystem.colors.surface)
                .foregroundStyle(message.isFromCurrentUser ? designSystem.colors.onPrimary : designSystem.colors.onSurface)
                .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous))
            Text(message.timestamp)
                .font(designSystem.typography.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: message.isFromCurrentUser ? .trailing : .leading)
    }
}

private struct MessageThread: Identifiable, Hashable {
    let id = UUID()
    let participant: String
    let preview: String
    let time: String
    let isUnread: Bool
    let messages: [Message]

    static let samples: [MessageThread] = [
        .init(
            participant: "Sasha",
            preview: "Thanks for holding the dining set!",
            time: "2m",
            isUnread: true,
            messages: [
                .init(body: "Hey! I can pick it up tonight.", timestamp: "1m", isFromCurrentUser: false),
                .init(body: "Great, see you at 6!", timestamp: "Just now", isFromCurrentUser: true)
            ]
        ),
        .init(
            participant: "Morgan",
            preview: "Photos look awesome—can you share more?",
            time: "1h",
            isUnread: false,
            messages: [
                .init(body: "Uploading an album now.", timestamp: "1h", isFromCurrentUser: true),
                .init(body: "Perfect, thanks!", timestamp: "58m", isFromCurrentUser: false)
            ]
        )
    ]
}

private struct Message: Identifiable, Hashable {
    let id = UUID()
    let body: String
    let timestamp: String
    let isFromCurrentUser: Bool
}
