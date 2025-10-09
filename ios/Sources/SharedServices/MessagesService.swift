import Foundation
import SharedCoreBridge
import JavaScriptCore

public struct ConversationSummary: Identifiable, Equatable, Hashable {
    public let id: String
    public let listingID: String?
    public let listingTitle: String?
    public let listingOwnerID: String?
    public let coverImage: String?
    public let otherUserID: String
    public let otherUserName: String
    public let lastMessageID: String?
    public let lastMessageBody: String
    public let lastMessageDate: Date?
    public let lastMessageSenderID: String?
    public let lastMessageIsAdmin: Bool
    public var isUnread: Bool
    public let otherUserDeleted: Bool

    public init?(dictionary: [String: Any]) {
        guard let identifier = ConversationSummary.parseIdentifier(dictionary["id"]) else { return nil }
        guard let otherIdentifier = ConversationSummary.parseIdentifier(dictionary["other_user_id"]) else { return nil }

        id = identifier
        listingID = ConversationSummary.parseIdentifier(dictionary["listing_id"])
        listingTitle = ConversationSummary.parseString(dictionary["listing_title"])
        listingOwnerID = ConversationSummary.parseIdentifier(dictionary["listing_owner_id"])
        coverImage = ConversationSummary.parseString(dictionary["image_data"])
        otherUserID = otherIdentifier
        otherUserName = ConversationSummary.parseString(dictionary["other_user_username"]) ?? "Unknown"
        lastMessageID = ConversationSummary.parseIdentifier(dictionary["last_message_id"])
        let rawBody = ConversationSummary.parseString(dictionary["last_message_body"]) ?? ""
        lastMessageBody = rawBody.trimmingCharacters(in: .whitespacesAndNewlines)
        lastMessageDate = ConversationSummary.parseDate(dictionary["last_message_at"])
        lastMessageSenderID = ConversationSummary.parseIdentifier(dictionary["last_message_sender_id"])
        lastMessageIsAdmin = ConversationSummary.parseBool(dictionary["last_message_is_admin"])
        let unreadSource = ConversationSummary.parseIdentifier(dictionary["last_message_sender_id"])
        isUnread = unreadSource == otherIdentifier && unreadSource != nil
        otherUserDeleted = ConversationSummary.parseBool(dictionary["other_user_deleted"]) || ConversationSummary.parseBool(dic
tionary["otherUserDeleted"])
    }

    public init(id: String,
                listingID: String?,
                listingTitle: String?,
                listingOwnerID: String?,
                coverImage: String?,
                otherUserID: String,
                otherUserName: String,
                lastMessageID: String?,
                lastMessageBody: String,
                lastMessageDate: Date?,
                lastMessageSenderID: String?,
                lastMessageIsAdmin: Bool,
                isUnread: Bool,
                otherUserDeleted: Bool) {
        self.id = id
        self.listingID = listingID
        self.listingTitle = listingTitle
        self.listingOwnerID = listingOwnerID
        self.coverImage = coverImage
        self.otherUserID = otherUserID
        self.otherUserName = otherUserName
        self.lastMessageID = lastMessageID
        self.lastMessageBody = lastMessageBody
        self.lastMessageDate = lastMessageDate
        self.lastMessageSenderID = lastMessageSenderID
        self.lastMessageIsAdmin = lastMessageIsAdmin
        self.isUnread = isUnread
        self.otherUserDeleted = otherUserDeleted
    }

    public func updatingLastMessage(with message: ConversationMessage) -> ConversationSummary {
        ConversationSummary(
            id: id,
            listingID: listingID,
            listingTitle: listingTitle,
            listingOwnerID: listingOwnerID,
            coverImage: coverImage,
            otherUserID: otherUserID,
            otherUserName: otherUserName,
            lastMessageID: message.id,
            lastMessageBody: message.body,
            lastMessageDate: message.sentAt,
            lastMessageSenderID: message.senderID,
            lastMessageIsAdmin: message.isFromAdmin,
            isUnread: message.senderID == otherUserID,
            otherUserDeleted: otherUserDeleted
        )
    }

    public func markingRead() -> ConversationSummary {
        ConversationSummary(
            id: id,
            listingID: listingID,
            listingTitle: listingTitle,
            listingOwnerID: listingOwnerID,
            coverImage: coverImage,
            otherUserID: otherUserID,
            otherUserName: otherUserName,
            lastMessageID: lastMessageID,
            lastMessageBody: lastMessageBody,
            lastMessageDate: lastMessageDate,
            lastMessageSenderID: lastMessageSenderID,
            lastMessageIsAdmin: lastMessageIsAdmin,
            isUnread: false,
            otherUserDeleted: otherUserDeleted
        )
    }
}

public struct ConversationMessage: Identifiable, Equatable, Hashable {
    public let id: String
    public let body: String
    public let senderID: String
    public let senderName: String?
    public let sentAt: Date?
    public let images: [String]
    public let isFromAdmin: Bool

    init?(dictionary: [String: Any]) {
        guard let identifier = ConversationSummary.parseIdentifier(dictionary["id"]) else { return nil }
        guard let senderIdentifier = ConversationSummary.parseIdentifier(dictionary["sender_id"]) else { return nil }

        id = identifier
        body = ConversationSummary.parseString(dictionary["body"]) ?? ""
        senderID = senderIdentifier
        senderName = ConversationSummary.parseString(dictionary["sender_username"]) ?? ConversationSummary.parseString(dictionary["sender_name"])
        sentAt = ConversationSummary.parseDate(dictionary["created_at"])
        images = ConversationMessage.parseImages(dictionary["images"])
        isFromAdmin = ConversationSummary.parseBool(dictionary["sender_is_admin"]) || ConversationSummary.parseBool(dictionary["is_admin"])
    }

    public init(id: String,
                body: String,
                senderID: String,
                senderName: String?,
                sentAt: Date?,
                images: [String],
                isFromAdmin: Bool) {
        self.id = id
        self.body = body
        self.senderID = senderID
        self.senderName = senderName
        self.sentAt = sentAt
        self.images = images
        self.isFromAdmin = isFromAdmin
    }

    private static func parseImages(_ value: Any?) -> [String] {
        guard let value else { return [] }
        if let array = value as? [Any] {
            return array.compactMap { element in
                if let string = element as? String {
                    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
                    return trimmed.isEmpty ? nil : trimmed
                }
                return nil
            }
        }
        if let single = value as? String {
            let trimmed = single.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? [] : [trimmed]
        }
        return []
    }
}
public struct SendMessageResult: Equatable {
    public let message: ConversationMessage
    public let otherUserDeleted: Bool
}

public enum MessagesServiceError: Error {
    case invalidResponse
    case emptyMessage
}

public protocol MessagesServiceProviding {
    func fetchConversations() async throws -> [ConversationSummary]
    func fetchMessages(conversationID: String) async throws -> [ConversationMessage]
    func sendMessage(conversationID: String, body: String) async throws -> SendMessageResult
    func deleteConversation(conversationID: String) async throws
}

public final class MessagesService: MessagesServiceProviding {
    private let runtime: SharedRuntime

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
    }

    public func fetchConversations() async throws -> [ConversationSummary] {
        let value = try runtime.call(function: "ListItCore.api.listConversations", with: [])
        guard let array = value.toArray() else { return [] }
        let contexts = array.compactMap(MessagesService.dictionary(from:))
        return contexts.compactMap(ConversationSummary.init(dictionary:))
    }

    public func fetchMessages(conversationID: String) async throws -> [ConversationMessage] {
        let identifier = MessagesService.coerceIdentifier(conversationID)
        let value = try runtime.call(function: "ListItCore.api.getMessages", with: [identifier])
        guard let array = value.toArray() else { return [] }
        let contexts = array.compactMap(MessagesService.dictionary(from:))
        return contexts.compactMap(ConversationMessage.init(dictionary:))
    }

    public func sendMessage(conversationID: String, body: String) async throws -> SendMessageResult {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw MessagesServiceError.emptyMessage }

        let identifier = MessagesService.coerceIdentifier(conversationID)
        let value = try runtime.call(function: "ListItCore.api.sendMessage", with: [identifier, trimmed, []])
        guard let response = value.toDictionary(),
              let messageDictionary = MessagesService.dictionary(from: response["message"]),
              let message = ConversationMessage(dictionary: messageDictionary) else {
            throw MessagesServiceError.invalidResponse
        }
        let otherDeleted = ConversationSummary.parseBool(response["other_user_deleted"]) || ConversationSummary.parseBool(resp
onse["otherUserDeleted"])
        return SendMessageResult(message: message, otherUserDeleted: otherDeleted)
    }

    public func deleteConversation(conversationID: String) async throws {
        let identifier = MessagesService.coerceIdentifier(conversationID)
        _ = try runtime.call(function: "ListItCore.api.deleteConversation", with: [identifier])
    }
}

private extension MessagesService {
    static func dictionary(from value: Any?) -> [String: Any]? {
        if let dictionary = value as? [String: Any] { return dictionary }
        if let dictionary = value as? [AnyHashable: Any] {
            var output: [String: Any] = [:]
            for (key, value) in dictionary {
                let stringKey: String
                if let key = key as? String { stringKey = key }
                else { stringKey = String(describing: key) }
                output[stringKey] = value
            }
            return output
        }
        if let dictionary = value as? NSDictionary {
            var output: [String: Any] = [:]
            for (key, value) in dictionary {
                let stringKey: String
                if let key = key as? String { stringKey = key }
                else { stringKey = String(describing: key) }
                output[stringKey] = value
            }
            return output
        }
        return nil
    }

    static func coerceIdentifier(_ identifier: String) -> Any {
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        if let intValue = Int(trimmed) { return intValue }
        if let doubleValue = Double(trimmed), doubleValue.rounded() == doubleValue { return Int(doubleValue) }
        return trimmed
    }
}

private extension ConversationSummary {
    static func parseIdentifier(_ value: Any?) -> String? {
        guard let value else { return nil }
        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let number = value as? NSNumber {
            return number.stringValue
        }
        if let convertible = value as? CustomStringConvertible {
            let description = convertible.description.trimmingCharacters(in: .whitespacesAndNewlines)
            return description.isEmpty ? nil : description
        }
        return nil
    }

    static func parseString(_ value: Any?) -> String? {
        guard let value else { return nil }
        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let number = value as? NSNumber {
            return number.stringValue
        }
        return nil
    }

    static func parseBool(_ value: Any?) -> Bool {
        guard let value else { return false }
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let string = value as? String {
            let normalized = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return ["1", "true", "yes"].contains(normalized)
        }
        return false
    }

    static func parseDate(_ value: Any?) -> Date? {
        guard let value else { return nil }
        if let date = value as? Date { return date }
        if let number = value as? NSNumber {
            let seconds = number.doubleValue
            if seconds > 1_000_000_000_000 { return Date(timeIntervalSince1970: seconds / 1000) }
            if seconds > 1_000_000_000 { return Date(timeIntervalSince1970: seconds) }
            return Date(timeIntervalSince1970: seconds)
        }
        if let string = value as? String {
            if let numeric = Double(string) {
                if numeric > 1_000_000_000_000 { return Date(timeIntervalSince1970: numeric / 1000) }
                if numeric > 1_000_000_000 { return Date(timeIntervalSince1970: numeric) }
            }
            if let parsed = ISO8601DateFormatter().date(from: string) {
                return parsed
            }
            if let parsed = DateFormatter.messagesFallback.date(from: string) {
                return parsed
            }
        }
        return nil
    }
}

private extension DateFormatter {
    static let messagesFallback: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()
}
