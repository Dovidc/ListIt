import Foundation
import SharedCoreBridge

public struct ListingSummary {
    public let id: String
    public let title: String
    public let subtitle: String

    public init(id: String, title: String, subtitle: String) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
    }
}

public final class ListingsService {
    private let runtime: SharedRuntime

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
    }

    public func fetchListings() async throws -> [ListingSummary] {
        let result = try runtime.call(function: "listings_fetch", with: [])
        guard let array = result.toArray() as? [[String: Any]] else {
            return []
        }
        return array.map { item in
            let id = item["id"] as? String ?? UUID().uuidString
            let title = item["title"] as? String ?? "Untitled"
            let subtitle = item["subtitle"] as? String ?? ""
            return ListingSummary(id: id, title: title, subtitle: subtitle)
        }
    }
}
