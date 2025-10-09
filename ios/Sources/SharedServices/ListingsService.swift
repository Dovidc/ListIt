import Foundation
import SharedCoreBridge

public struct ListingSummary: Identifiable, Equatable {
    public struct GalleryImage: Equatable, Hashable {
        public let url: URL
        public let width: Double?
        public let height: Double?

        public init(url: URL, width: Double? = nil, height: Double? = nil) {
            self.url = url
            self.width = width
            self.height = height
        }
    }

    public let id: String
    public let title: String
    public let subtitle: String
    public let priceText: String?
    public let price: Double?
    public let location: String?
    public let description: String
    public let tags: [String]
    public let coverImageURL: URL?
    public let galleryImages: [GalleryImage]
    public let sellerName: String?
    public let sellerAvatarURL: URL?
    public let createdAt: Date?
    public let isFavorite: Bool
    public let isBoosted: Bool
    public let isSold: Bool
    public let distanceText: String?
    public let distanceMeters: Double?

    public init(id: String,
                title: String,
                subtitle: String,
                priceText: String? = nil,
                price: Double? = nil,
                location: String? = nil,
                description: String = "",
                tags: [String] = [],
                coverImageURL: URL? = nil,
                galleryImages: [GalleryImage] = [],
                sellerName: String? = nil,
                sellerAvatarURL: URL? = nil,
                createdAt: Date? = nil,
                isFavorite: Bool = false,
                isBoosted: Bool = false,
                isSold: Bool = false,
                distanceText: String? = nil,
                distanceMeters: Double? = nil) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.priceText = priceText
        self.price = price
        self.location = location
        self.description = description
        self.tags = tags
        self.coverImageURL = coverImageURL
        self.galleryImages = galleryImages
        self.sellerName = sellerName
        self.sellerAvatarURL = sellerAvatarURL
        self.createdAt = createdAt
        self.isFavorite = isFavorite
        self.isBoosted = isBoosted
        self.isSold = isSold
        self.distanceText = distanceText
        self.distanceMeters = distanceMeters
    }

    public func updatingFavorite(_ isFavorite: Bool) -> ListingSummary {
        ListingSummary(
            id: id,
            title: title,
            subtitle: subtitle,
            priceText: priceText,
            price: price,
            location: location,
            description: description,
            tags: tags,
            coverImageURL: coverImageURL,
            galleryImages: galleryImages,
            sellerName: sellerName,
            sellerAvatarURL: sellerAvatarURL,
            createdAt: createdAt,
            isFavorite: isFavorite,
            isBoosted: isBoosted,
            isSold: isSold,
            distanceText: distanceText,
            distanceMeters: distanceMeters
        )
    }

    public func updatingCoverImage(_ url: URL?) -> ListingSummary {
        ListingSummary(
            id: id,
            title: title,
            subtitle: subtitle,
            priceText: priceText,
            price: price,
            location: location,
            description: description,
            tags: tags,
            coverImageURL: url,
            galleryImages: galleryImages,
            sellerName: sellerName,
            sellerAvatarURL: sellerAvatarURL,
            createdAt: createdAt,
            isFavorite: isFavorite,
            isBoosted: isBoosted,
            isSold: isSold,
            distanceText: distanceText,
            distanceMeters: distanceMeters
        )
    }
}

public struct ListingsPage {
    public let listings: [ListingSummary]
    public let hasNext: Bool
    public let nextCursor: String?

    public init(listings: [ListingSummary], hasNext: Bool, nextCursor: String?) {
        self.listings = listings
        self.hasNext = hasNext
        self.nextCursor = nextCursor
    }
}

public enum ListingsSort: String, CaseIterable {
    case newest = "new"
    case priceLow = "price_low"
    case priceHigh = "price_high"
    case nearby = "near"

    public var title: String {
        switch self {
        case .newest:
            return "Newest"
        case .priceLow:
            return "Price ↑"
        case .priceHigh:
            return "Price ↓"
        case .nearby:
            return "Nearby"
        }
    }
}

public struct ListingsQuery: Equatable {
    public var search: String
    public var location: String
    public var sort: ListingsSort

    public init(search: String = "", location: String = "", sort: ListingsSort = .newest) {
        self.search = search
        self.location = location
        self.sort = sort
    }
}

public struct ListingDraft {
    public var title: String
    public var description: String
    public var location: String
    public var price: Double?
    public var tags: [String]
    public var enableNearby: Bool
    public var inquiryEnabled: Bool
    public var latitude: Double?
    public var longitude: Double?
    public var uploadTokens: [String]

    public init(title: String,
                description: String,
                location: String,
                price: Double? = nil,
                tags: [String] = [],
                enableNearby: Bool = false,
                inquiryEnabled: Bool = false,
                latitude: Double? = nil,
                longitude: Double? = nil,
                uploadTokens: [String]) {
        self.title = title
        self.description = description
        self.location = location
        self.price = price
        self.tags = tags
        self.enableNearby = enableNearby
        self.inquiryEnabled = inquiryEnabled
        self.latitude = latitude
        self.longitude = longitude
        self.uploadTokens = uploadTokens
    }

    fileprivate func toDictionary() -> [String: Any] {
        var dictionary: [String: Any] = [
            "title": title,
            "description": description,
            "location": location,
            "upload_tokens": uploadTokens
        ]
        if let price { dictionary["price"] = price }
        if !tags.isEmpty { dictionary["tags"] = tags }
        if enableNearby { dictionary["enable_nearby"] = true }
        if inquiryEnabled { dictionary["inquiry_enabled"] = true }
        if let latitude { dictionary["lat"] = latitude }
        if let longitude { dictionary["lon"] = longitude }
        return dictionary
    }
}

public struct ListingUpdate {
    public var title: String?
    public var description: String?
    public var location: String?
    public var price: Double?
    public var tags: [String]?
    public var enableNearby: Bool?
    public var inquiryEnabled: Bool?
    public var sold: Bool?
    public var latitude: Double?
    public var longitude: Double?
    public var deletedImages: [URL]?

    public init(title: String? = nil,
                description: String? = nil,
                location: String? = nil,
                price: Double? = nil,
                tags: [String]? = nil,
                enableNearby: Bool? = nil,
                inquiryEnabled: Bool? = nil,
                sold: Bool? = nil,
                latitude: Double? = nil,
                longitude: Double? = nil,
                deletedImages: [URL]? = nil) {
        self.title = title
        self.description = description
        self.location = location
        self.price = price
        self.tags = tags
        self.enableNearby = enableNearby
        self.inquiryEnabled = inquiryEnabled
        self.sold = sold
        self.latitude = latitude
        self.longitude = longitude
        self.deletedImages = deletedImages
    }

    fileprivate func toDictionary() -> [String: Any] {
        var dictionary: [String: Any] = [:]
        if let title { dictionary["title"] = title }
        if let description { dictionary["description"] = description }
        if let location { dictionary["location"] = location }
        if let price { dictionary["price"] = price }
        if let tags { dictionary["tags"] = tags }
        if let enableNearby { dictionary["enable_nearby"] = enableNearby }
        if let inquiryEnabled { dictionary["inquiry_enabled"] = inquiryEnabled }
        if let sold { dictionary["sold"] = sold }
        if let latitude { dictionary["lat"] = latitude }
        if let longitude { dictionary["lon"] = longitude }
        if let deletedImages, !deletedImages.isEmpty {
            dictionary["deletedImages"] = deletedImages.map { $0.absoluteString }
        }
        return dictionary
    }
}

public struct ListingAIAnalysis: Equatable {
    public let title: String
    public let description: String
    public let tags: [String]
    public let suggestedPrice: Double?

    public init(title: String, description: String, tags: [String], suggestedPrice: Double?) {
        self.title = title
        self.description = description
        self.tags = tags
        self.suggestedPrice = suggestedPrice
    }
}

public enum ListingsServiceError: Error {
    case invalidResponse
}

public final class ListingsService {
    private enum Constants {
        static let defaultLimit = 25
    }

    private let runtime: SharedRuntime
    private let persistence: ListingsPersisting

    public init(runtime: SharedRuntime, persistence: ListingsPersisting = CoreDataListingsPersistence()) {
        self.runtime = runtime
        self.persistence = persistence
    }

    public func fetchListings(query: ListingsQuery = ListingsQuery(), cursor: String? = nil, limit: Int = Constants.defaultLimit) async throws -> ListingsPage {
        let parameters = makeParameters(query: query, cursor: cursor, limit: limit)
        do {
            let result = try runtime.call(function: "listings_feed", with: [parameters])
            guard let dictionary = result.toDictionary() else {
                try persistence.clear()
                return ListingsPage(listings: [], hasNext: false, nextCursor: nil)
            }

            let listings = Self.parseListings(from: dictionary)
            try persistence.store(listings: listings)

            let hasNext = Self.parseBool(dictionary["hasNext"]) || Self.parseBool(dictionary["next"])
            let nextCursor = Self.parseString(dictionary["nextCursor"]) ?? Self.parseString(dictionary["cursor"])
            return ListingsPage(listings: listings, hasNext: hasNext, nextCursor: nextCursor)
        } catch {
            let cached = try persistence.loadListings()
            if !cached.isEmpty {
                return ListingsPage(listings: cached, hasNext: false, nextCursor: nil)
            }
            throw error
        }
    }

    public func fetchListings() async throws -> [ListingSummary] {
        try await fetchListings(query: ListingsQuery()).listings
    }

    public func createListing(from draft: ListingDraft) async throws -> ListingSummary {
        let response = try runtime.call(function: "listings_create", with: [draft.toDictionary()])
        guard let dictionary = response.toDictionary(), let listing = Self.parseListing(from: dictionary) else {
            throw ListingsServiceError.invalidResponse
        }
        return listing
    }

    public func updateListing(id: String, with update: ListingUpdate) async throws -> ListingSummary {
        let response = try runtime.call(function: "listings_update", with: [id, update.toDictionary()])
        guard let dictionary = response.toDictionary(), let listing = Self.parseListing(from: dictionary) else {
            throw ListingsServiceError.invalidResponse
        }
        return listing
    }

    public func deleteListing(id: String) async throws {
        let response = try runtime.call(function: "listings_delete", with: [id])
        if !response.toBool() {
            throw ListingsServiceError.invalidResponse
        }
    }

    public func markListing(_ id: String, sold: Bool) async throws -> ListingSummary {
        let response = try runtime.call(function: "listings_mark_sold", with: [id, sold])
        guard let dictionary = response.toDictionary(), let listing = Self.parseListing(from: dictionary) else {
            throw ListingsServiceError.invalidResponse
        }
        return listing
    }

    public func fetchImages(forListing id: String, minimumCount: Int = 0) async throws -> [ListingSummary.GalleryImage] {
        let options: [String: Any] = ["minCount": minimumCount]
        let response = try runtime.call(function: "listings_get_images", with: [id, options])
        guard let array = response.toArray() else { return [] }
        return Self.parseGallery(array)
    }

    public func analyzeListing(images: [URL], hint: String? = nil) async throws -> ListingAIAnalysis {
        let payload: [String: Any] = [
            "images": images.map { $0.absoluteString },
            "hint": hint ?? ""
        ]
        let response = try runtime.call(function: "listings_ai_analyze", with: [payload])
        guard let dictionary = response.toDictionary() else {
            throw ListingsServiceError.invalidResponse
        }

        let title = Self.parseString(dictionary["title"]) ?? "Item for sale"
        let description = Self.parseString(dictionary["description"]) ?? ""
        let tags = Self.parseTags(dictionary["tags"])
        let suggested = Self.parseNumber(dictionary["suggested_price"] ?? dictionary["suggestedPrice"])

        return ListingAIAnalysis(title: title, description: description, tags: tags, suggestedPrice: suggested)
    }

    private func makeParameters(query: ListingsQuery, cursor: String?, limit: Int) -> [String: Any] {
        var payload: [String: Any] = ["limit": limit]
        if !query.search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["query"] = query.search
        }
        if !query.location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["location"] = query.location
        }
        payload["sort"] = query.sort.rawValue
        if let cursor, !cursor.isEmpty {
            payload["cursor"] = cursor
        }
        return payload
    }

    private static func parseListings(from dictionary: [AnyHashable: Any]) -> [ListingSummary] {
        guard let items = dictionary["items"] as? [Any] else { return [] }
        return items.compactMap { element in
            guard let item = element as? [String: Any] else { return nil }
            return parseListing(from: item)
        }
    }

    private static func parseListing(from dictionary: [String: Any]) -> ListingSummary? {
        guard let id = parseIdentifier(dictionary["id"]) else { return nil }
        let title = parseString(dictionary["title"]) ?? "Untitled"
        let subtitle = parseString(dictionary["subtitle"]) ?? ""
        let priceText = parseString(dictionary["priceText"]) ?? parseString(dictionary["price_label"])
        let price = parseNumber(dictionary["price"])
        let location = parseString(dictionary["location"]) ?? parseString(dictionary["locationLabel"])
        let description = parseString(dictionary["description"]) ?? ""
        let tags = parseTags(dictionary["tags"])
        let coverURL = parseURL(dictionary["coverImage"] ?? dictionary["cover"] ?? dictionary["image"] ?? dictionary["imageURL"])
        let gallery = parseGallery(dictionary["gallery"])
        let seller = parseString(dictionary["sellerName"] ?? dictionary["seller"] ?? dictionary["owner"])
        let sellerAvatar = parseURL(dictionary["sellerAvatar"] ?? dictionary["ownerAvatar"])
        let createdAt = parseDate(dictionary["createdAt"])
        let isFavorite = parseBool(dictionary["isFavorite"])
        let isBoosted = parseBool(dictionary["isBoosted"])
        let isSold = parseBool(dictionary["isSold"])
        let distanceText = parseString(dictionary["distanceText"])
        let distanceMeters = parseNumber(dictionary["distanceMeters"])

        return ListingSummary(
            id: id,
            title: title,
            subtitle: subtitle,
            priceText: priceText,
            price: price,
            location: location,
            description: description,
            tags: tags,
            coverImageURL: coverURL,
            galleryImages: gallery,
            sellerName: seller,
            sellerAvatarURL: sellerAvatar,
            createdAt: createdAt,
            isFavorite: isFavorite,
            isBoosted: isBoosted,
            isSold: isSold,
            distanceText: distanceText,
            distanceMeters: distanceMeters
        )
    }

    private static func parseIdentifier(_ value: Any?) -> String? {
        if let string = value as? String, !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return string
        }
        if let number = value as? NSNumber { return number.stringValue }
        if let dictionary = value as? [String: Any] {
            if let nested = dictionary["id"] { return parseIdentifier(nested) }
            if let nested = dictionary["listing_id"] { return parseIdentifier(nested) }
        }
        return nil
    }

    private static func parseString(_ value: Any?) -> String? {
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

    private static func parseNumber(_ value: Any?) -> Double? {
        guard let value else { return nil }
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String {
            let cleaned = string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty, let parsed = Double(cleaned) else { return nil }
            return parsed
        }
        return nil
    }

    private static func parseBool(_ value: Any?) -> Bool {
        guard let value else { return false }
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let string = value as? String {
            let normalized = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return ["1", "true", "yes", "y", "on"].contains(normalized)
        }
        return false
    }

    private static func parseTags(_ value: Any?) -> [String] {
        guard let value else { return [] }
        if let array = value as? [String] {
            return array.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        }
        if let array = value as? [Any] {
            return array.compactMap { element in
                if let string = element as? String {
                    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
                    return trimmed.isEmpty ? nil : trimmed
                }
                if let number = element as? NSNumber {
                    return number.stringValue
                }
                return nil
            }
        }
        if let string = value as? String {
            return string
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }
        return []
    }

    private static func parseURL(_ value: Any?) -> URL? {
        guard let string = parseString(value) else { return nil }
        return URL(string: string)
    }

    private static func parseGallery(_ value: Any?) -> [ListingSummary.GalleryImage] {
        guard let array = value as? [Any] else { return [] }
        return array.compactMap { element in
            guard let dictionary = element as? [String: Any], let url = parseURL(dictionary["url"] ?? dictionary["image"] ?? dictionary["src"]) else { return nil }
            let width = parseNumber(dictionary["width"] ?? dictionary["w"])
            let height = parseNumber(dictionary["height"] ?? dictionary["h"])
            return ListingSummary.GalleryImage(url: url, width: width, height: height)
        }
    }

    private static func parseDate(_ value: Any?) -> Date? {
        guard let value else { return nil }
        if let date = value as? Date { return date }
        if let number = value as? NSNumber {
            let seconds = number.doubleValue
            if seconds > 9_999_999_999 { // milliseconds
                return Date(timeIntervalSince1970: seconds / 1_000)
            }
            return Date(timeIntervalSince1970: seconds)
        }
        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            if let seconds = Double(trimmed) {
                return parseDate(seconds as NSNumber)
            }
            if let parsed = ISO8601DateFormatter().date(from: trimmed) {
                return parsed
            }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZ"
            return formatter.date(from: trimmed)
        }
        return nil
    }
}
