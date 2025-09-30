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
    private let persistence: ListingsPersisting

    public init(runtime: SharedRuntime, persistence: ListingsPersisting = CoreDataListingsPersistence()) {
        self.runtime = runtime
        self.persistence = persistence
    }

    public func fetchListings() async throws -> [ListingSummary] {
        do {
            let result = try runtime.call(function: "listings_fetch", with: [])
            guard let array = result.toArray() as? [[String: Any]] else {
                try persistence.clear()
                return []
            }
            let summaries = array.map { item in
                let id = item["id"] as? String ?? UUID().uuidString
                let title = item["title"] as? String ?? "Untitled"
                let subtitle = item["subtitle"] as? String ?? ""
                return ListingSummary(id: id, title: title, subtitle: subtitle)
            }
            try persistence.store(listings: summaries)
            return summaries
        } catch {
            let cached = try persistence.loadListings()
            if !cached.isEmpty {
                return cached
            }
            throw error
        }
    }
}
