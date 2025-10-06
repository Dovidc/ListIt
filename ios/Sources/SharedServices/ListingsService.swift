import Foundation
import SharedCoreBridge

public struct ListingSummary: Codable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let subtitle: String
    public let price: Double?
    public let location: String?

    public init(id: String,
                title: String,
                subtitle: String,
                price: Double? = nil,
                location: String? = nil) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.price = price
        self.location = location
    }
}

public struct ListingsPage: Equatable {
    public let listings: [ListingSummary]
    public let hasNext: Bool
    public let nextCursor: String?

    public init(listings: [ListingSummary], hasNext: Bool, nextCursor: String?) {
        self.listings = listings
        self.hasNext = hasNext
        self.nextCursor = nextCursor
    }
}

public struct ListingsRequest: Equatable {
    public enum Sort: String, CaseIterable, Identifiable {
        case newest = "new"
        case priceLow = "price_low"
        case priceHigh = "price_high"
        case nearest = "distance"

        public var id: String { rawValue }

        public var displayName: String {
            switch self {
            case .newest: return "Newest"
            case .priceLow: return "Price: Low"
            case .priceHigh: return "Price: High"
            case .nearest: return "Nearby"
            }
        }
    }

    public var query: String
    public var location: String
    public var sort: Sort
    public var limit: Int
    public var cursor: String?

    public init(query: String = "",
                location: String = "",
                sort: Sort = .newest,
                limit: Int = 25,
                cursor: String? = nil) {
        self.query = query
        self.location = location
        self.sort = sort
        self.limit = limit
        self.cursor = cursor
    }

    fileprivate func parameters() -> [String: Any] {
        var params: [String: Any] = [
            "limit": limit,
            "sort": sort.rawValue
        ]

        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            params["query"] = query
        }
        if !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            params["location"] = location
        }
        if let cursor, !cursor.isEmpty {
            params["cursor"] = cursor
        }

        return params
    }
}

public final class ListingsService {
    private let runtime: SharedRuntime
    private let persistence: ListingsPersisting

    public init(runtime: SharedRuntime, persistence: ListingsPersisting = CoreDataListingsPersistence()) {
        self.runtime = runtime
        self.persistence = persistence
    }

    public func fetchListings(request: ListingsRequest = ListingsRequest()) async throws -> ListingsPage {
        do {
            let result = try runtime.call(function: "listings_fetch", with: [request.parameters()])
            guard let response = result.toDictionary() as? [String: Any] else {
                try persistence.clear()
                return ListingsPage(listings: [], hasNext: false, nextCursor: nil)
            }

            let items = (response["items"] as? [Any] ?? response["rows"] as? [Any] ?? [])
                .compactMap { item -> ListingSummary? in
                    guard let dictionary = item as? [String: Any] else { return nil }
                    let id = dictionary["id"] as? String ?? UUID().uuidString
                    let title = dictionary["title"] as? String ?? "Untitled"
                    let subtitle = dictionary["subtitle"] as? String ?? ""
                    let priceValue = ListingsService.resolveNumeric(dictionary["price"])
                    let location = dictionary["location"] as? String ?? (dictionary["location"] as? NSString).map(String.init)
                    return ListingSummary(id: id, title: title, subtitle: subtitle, price: priceValue, location: location)
                }

            try persistence.store(listings: items)

            let hasNextValue = response["hasNext"]
            let hasNext = (hasNextValue as? Bool) ?? (hasNextValue as? NSNumber)?.boolValue ?? false
            let nextCursor: String?
            if let cursorString = response["nextCursor"] as? String {
                nextCursor = cursorString
            } else if let cursorNumber = response["nextCursor"] as? NSNumber {
                nextCursor = cursorNumber.stringValue
            } else if let cursorNSString = response["nextCursor"] as? NSString {
                nextCursor = String(cursorNSString)
            } else {
                nextCursor = nil
            }

            return ListingsPage(listings: items, hasNext: hasNext, nextCursor: nextCursor)
        } catch {
            let cached = try persistence.loadListings()
            if !cached.isEmpty {
                return ListingsPage(listings: cached, hasNext: false, nextCursor: nil)
            }
            throw error
        }
    }

    public func fetchListings() async throws -> [ListingSummary] {
        try await fetchListings(request: ListingsRequest()).listings
    }
}

private extension ListingsService {
    static func resolveNumeric(_ value: Any?) -> Double? {
        if let number = value as? NSNumber {
            return number.doubleValue
        }
        if let double = value as? Double {
            return double
        }
        if let string = value as? String, let double = Double(string) {
            return double
        }
        return nil
    }
}
