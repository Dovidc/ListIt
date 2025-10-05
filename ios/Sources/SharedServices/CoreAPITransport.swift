import Foundation
import SharedCoreBridge

public final class CoreAPITransport {
    private let client: SharedCoreClient

    public init(runtime: SharedRuntime) {
        self.client = SharedCoreClient(runtime: runtime)
    }

    public func request(path: String, requestInit: [String: Any]? = nil, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [path]
        if let requestInit { arguments.append(requestInit) }
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        return try client.callObject("api.request", arguments: arguments)
    }
}
