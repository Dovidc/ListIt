import Foundation

public protocol ListingsPersisting {
    func store(listings: [ListingSummary]) throws
    func loadListings() throws -> [ListingSummary]
    func clear() throws
}

public final class CoreDataListingsPersistence: ListingsPersisting {
    private let userDefaults: UserDefaults
    private let key = "cached_listings"

    public init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    public func store(listings: [ListingSummary]) throws {
        let encoder = JSONEncoder()
        let data = try encoder.encode(listings.map { CachedListing(from: $0) })
        userDefaults.set(data, forKey: key)
    }

    public func loadListings() throws -> [ListingSummary] {
        guard let data = userDefaults.data(forKey: key) else { return [] }
        let decoder = JSONDecoder()
        let cached = try decoder.decode([CachedListing].self, from: data)
        return cached.map { $0.toListing() }
    }

    public func clear() throws {
        userDefaults.removeObject(forKey: key)
    }
}

private struct CachedListing: Codable {
    let id: String
    let title: String
    let subtitle: String
    let price: Double?
    let location: String?

    init(from listing: ListingSummary) {
        self.id = listing.id
        self.title = listing.title
        self.subtitle = listing.subtitle
        self.price = listing.price
        self.location = listing.location
    }

    func toListing() -> ListingSummary {
        ListingSummary(id: id, title: title, subtitle: subtitle, price: price, location: location)
    }
}