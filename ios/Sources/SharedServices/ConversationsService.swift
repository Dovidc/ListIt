import Foundation
import SharedCoreBridge

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

    public func getMessages(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [id.description]
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        return try client.callObject("api.getMessages", arguments: arguments)
    }

    public func sendMessage(id: CustomStringConvertible, body: String, images: Any? = nil, meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = [id.description, body, images ?? NSNull()]
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        let value = try client.call("api.sendMessage", arguments: arguments)
        return value.toDictionary() as? [String: Any]
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
}
