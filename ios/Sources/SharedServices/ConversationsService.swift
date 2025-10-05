import Foundation
import SharedCoreBridge

public struct ConversationSummary: Identifiable, Equatable, Hashable {
    public let id: String
    public let title: String
    public let lastMessagePreview: String
    public let lastMessageAt: Date?
    public let unreadCount: Int

    public init(id: String, title: String, lastMessagePreview: String, lastMessageAt: Date?, unreadCount: Int) {
        self.id = id
        self.title = title
        self.lastMessagePreview = lastMessagePreview
        self.lastMessageAt = lastMessageAt
        self.unreadCount = unreadCount
    }
}

public struct ConversationMessage: Identifiable, Equatable {
    public let id: String
    public let body: String
    public let senderName: String
    public let sentAt: Date?
    public let attachmentURLs: [URL]

    public init(id: String, body: String, senderName: String, sentAt: Date?, attachmentURLs: [URL]) {
        self.id = id
        self.body = body
        self.senderName = senderName
        self.sentAt = sentAt
        self.attachmentURLs = attachmentURLs
    }
}

public final class ConversationsService {
    private let client: SharedCoreClient

    public init(runtime: SharedRuntime) {
        self.client = SharedCoreClient(runtime: runtime)
    }

    public func ensureConversation(payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = [payload]
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        let value = try client.call("api.ensureConversation", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }

    public func listConversations(meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = []
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        return try client.callObject("api.listConversations", arguments: arguments)
    }

    public func fetchConversations(meta: SharedCoreRequestMeta? = nil) async throws -> [ConversationSummary] {
        guard let response = try await listConversations(meta: meta) else { return [] }
        let values = try client.callArray("helpers.asArray", arguments: [response])
        return values.compactMap { raw in
            guard let dictionary = raw as? [String: Any] else { return nil }
            return conversationSummary(from: dictionary)
        }
    }

    public func getMessages(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [id.description]
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        return try client.callObject("api.getMessages", arguments: arguments)
    }

    public func fetchMessages(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> [ConversationMessage] {
        guard let response = try await getMessages(id: id, meta: meta) else { return [] }
        let values = try client.callArray("helpers.asArray", arguments: [response])
        return values.compactMap { raw in
            guard let dictionary = raw as? [String: Any] else { return nil }
            return conversationMessage(from: dictionary)
        }
    }

    public func sendMessage(id: CustomStringConvertible, body: String, images: Any? = nil, meta: SharedCoreRequestMeta? = nil) async throws -> ConversationMessage? {
        var arguments: [Any] = [id.description, body, images ?? NSNull()]
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        let value = try client.call("api.sendMessage", arguments: arguments)
        guard let dictionary = value.toDictionary() as? [String: Any] else { return nil }
        return conversationMessage(from: dictionary)
    }

    @discardableResult
    public func deleteConversation(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> Bool {
        var arguments: [Any] = [id.description]
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        _ = try client.call("api.deleteConversation", arguments: arguments)
        return true
    }

    private func conversationSummary(from dictionary: [String: Any]) -> ConversationSummary? {
        guard let identifier = stringIdentifier(from: dictionary["id"]) else { return nil }

        let title = firstNonEmpty(
            dictionary["listing_title"],
            dictionary["title"],
            dictionary["other_user_name"],
            dictionary["otherUserName"],
            dictionary["other_user_display"]
        ) ?? "Conversation"

        let preview = firstNonEmpty(
            dictionary["last_message_preview"],
            dictionary["lastMessagePreview"],
            dictionary["last_message"],
            dictionary["last_message_body"],
            dictionary["lastMessageBody"],
            dictionary["preview"]
        ) ?? ""

        let lastMessageAt = date(from: dictionary["last_message_at"] ?? dictionary["lastMessageAt"] ?? dictionary["updated_at"]) 

        var unread = integerValue(from: dictionary["unread_count"]) ??
            integerValue(from: dictionary["unreadCount"]) ??
            integerValue(from: dictionary["unread"])

        if unread == 0 {
            if let bool = dictionary["last_message_unread"] as? Bool, bool {
                unread = 1
            }
        }

        return ConversationSummary(
            id: identifier,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            lastMessagePreview: preview.trimmingCharacters(in: .whitespacesAndNewlines),
            lastMessageAt: lastMessageAt,
            unreadCount: max(0, unread)
        )
    }

    private func conversationMessage(from dictionary: [String: Any]) -> ConversationMessage? {
        guard let identifier = stringIdentifier(from: dictionary["id"]) else { return nil }

        let body = firstNonEmpty(
            dictionary["body"],
            dictionary["message"],
            dictionary["text"],
            dictionary["content"]
        ) ?? ""

        let senderName = firstNonEmpty(
            dictionary["sender_display_name"],
            dictionary["senderDisplayName"],
            dictionary["sender_name"],
            dictionary["sender"],
            dictionary["author"]
        ) ?? ""

        let sentAt = date(from: dictionary["created_at"] ?? dictionary["sent_at"] ?? dictionary["timestamp"])
        let attachments = attachmentURLs(from: dictionary)

        return ConversationMessage(
            id: identifier,
            body: body.trimmingCharacters(in: .whitespacesAndNewlines),
            senderName: senderName.trimmingCharacters(in: .whitespacesAndNewlines),
            sentAt: sentAt,
            attachmentURLs: attachments
        )
    }

    private func stringIdentifier(from value: Any?) -> String? {
        switch value {
        case let string as String where !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
            return string.trimmingCharacters(in: .whitespacesAndNewlines)
        case let number as NSNumber:
            return number.stringValue
        default:
            return nil
        }
    }

    private func integerValue(from value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String, let int = Int(string) { return int }
        return nil
    }

    private func date(from value: Any?) -> Date? {
        if let date = value as? Date { return date }
        if let number = value as? TimeInterval { return Date(timeIntervalSince1970: number) }
        if let string = value as? String {
            let isoFormatter = ISO8601DateFormatter()
            if let parsed = isoFormatter.date(from: string) { return parsed }
            if let interval = TimeInterval(string) { return Date(timeIntervalSince1970: interval) }
        }
        return nil
    }

    private func attachmentURLs(from dictionary: [String: Any]) -> [URL] {
        var urls: [URL] = []
        if let images = dictionary["images"] as? [Any] {
            urls.append(contentsOf: urls(from: images))
        }
        if let attachments = dictionary["attachments"] as? [Any] {
            urls.append(contentsOf: urls(from: attachments))
        }
        if let url = firstNonEmpty(dictionary["image_url"], dictionary["url"], dictionary["attachment_url"]) {
            if let parsed = URL(string: url) { urls.append(parsed) }
        }
        return Array(Set(urls))
    }

    private func urls(from array: [Any]) -> [URL] {
        array.compactMap { element in
            if let string = element as? String, let url = URL(string: string) { return url }
            if let dictionary = element as? [String: Any] {
                if let string = dictionary["url"] as? String, let url = URL(string: string) { return url }
                if let string = dictionary["href"] as? String, let url = URL(string: string) { return url }
            }
            return nil
        }
    }

    private func firstNonEmpty(_ values: Any?...) -> String? {
        for value in values {
            if let string = value as? String {
                let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
        }
        return nil
    }
}
