import Foundation

public struct SharedCoreRequestMeta: Sendable {
    public var silent: Bool?
    public var priority: String?
    public var additional: [String: Any]

    public init(silent: Bool? = nil, priority: String? = nil, additional: [String: Any] = [:]) {
        self.silent = silent
        self.priority = priority
        self.additional = additional
    }

    public func toDictionary() -> [String: Any] {
        var dictionary = additional
        if let silent { dictionary["silent"] = silent }
        if let priority { dictionary["priority"] = priority }
        return dictionary
    }

    public var isEmpty: Bool {
        toDictionary().isEmpty
    }
}
