import Foundation
import JavaScriptCore
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

public struct ListingDraft: Equatable {
    public var title: String
    public var description: String
    public var location: String
    public var price: Double?
    public var tags: [String]
    public var enableNearby: Bool
    public var latitude: Double?
    public var longitude: Double?
    public var uploadTokens: [String]
    public var deletedImages: [String]

    public init(
        title: String = "",
        description: String = "",
        location: String = "",
        price: Double? = nil,
        tags: [String] = [],
        enableNearby: Bool = false,
        latitude: Double? = nil,
        longitude: Double? = nil,
        uploadTokens: [String] = [],
        deletedImages: [String] = []
    ) {
        self.title = title
        self.description = description
        self.location = location
        self.price = price
        self.tags = tags
        self.enableNearby = enableNearby
        self.latitude = latitude
        self.longitude = longitude
        self.uploadTokens = uploadTokens
        self.deletedImages = deletedImages
    }

    fileprivate func payload(includeUploadTokens: Bool = true) -> [String: Any] {
        var payload: [String: Any] = [:]
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTitle.isEmpty { payload["title"] = trimmedTitle }

        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedDescription.isEmpty { payload["description"] = String(trimmedDescription.prefix(400)) }

        let trimmedLocation = location.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLocation.isEmpty { payload["location"] = String(trimmedLocation.prefix(80)) }

        if let price { payload["price"] = price }

        let normalizedTags = tags
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if !normalizedTags.isEmpty {
            payload["tags"] = normalizedTags.joined(separator: ", ")
        }

        if enableNearby {
            payload["enable_nearby"] = 1
            if let latitude { payload["lat"] = latitude }
            if let longitude { payload["lon"] = longitude }
        } else {
            payload["enable_nearby"] = 0
        }

        if includeUploadTokens {
            let orderedSet = NSOrderedSet(array: uploadTokens.filter { !$0.isEmpty })
            let uniqueTokens = orderedSet.compactMap { $0 as? String }
            if !uniqueTokens.isEmpty {
                payload["upload_tokens"] = uniqueTokens
            }
        }

        let normalizedDeletes = deletedImages
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if !normalizedDeletes.isEmpty {
            payload["deletedImages"] = normalizedDeletes
        }

        return payload
    }
}

public struct ListingDetail: Equatable, Identifiable {
    public let id: String
    public let title: String
    public let description: String
    public let location: String
    public let price: Double?
    public let tags: [String]
    public let enableNearby: Bool
    public let coverImage: String?
    public let images: [String]

    public init?(dictionary: [String: Any]) {
        guard let rawID = dictionary["id"] else { return nil }
        if let idString = rawID as? String {
            self.id = idString
        } else if let idNumber = rawID as? NSNumber {
            self.id = idNumber.stringValue
        } else if let idStringConvertible = rawID as? CustomStringConvertible {
            self.id = idStringConvertible.description
        } else {
            return nil
        }

        self.title = (dictionary["title"] as? String) ?? ""
        self.description = (dictionary["description"] as? String) ?? (dictionary["subtitle"] as? String) ?? ""
        self.location = (dictionary["location"] as? String) ?? ""

        if let priceNumber = dictionary["price"] as? NSNumber {
            self.price = priceNumber.doubleValue
        } else if let priceString = dictionary["price"] as? String, let parsed = Double(priceString) {
            self.price = parsed
        } else {
            self.price = nil
        }

        if let array = dictionary["tags"] as? [Any] {
            self.tags = array.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        } else if let tagsString = dictionary["tags"] as? String {
            self.tags = tagsString
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        } else {
            self.tags = []
        }

        if let enableValue = dictionary["enable_nearby"] as? NSNumber {
            self.enableNearby = enableValue.boolValue
        } else if let enableBool = dictionary["enable_nearby"] as? Bool {
            self.enableNearby = enableBool
        } else {
            self.enableNearby = false
        }

        if let cover = dictionary["image_data"] as? String {
            self.coverImage = cover
        } else if let cover = dictionary["cover"] as? String {
            self.coverImage = cover
        } else {
            self.coverImage = nil
        }

        if let imagesArray = dictionary["images"] as? [Any] {
            self.images = imagesArray.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        } else {
            self.images = []
        }
    }
}

public struct ListingAIAnalysis: Equatable {
    public let title: String
    public let description: String
    public let suggestedPrice: Double?
    public let tags: [String]

    public init(title: String, description: String, suggestedPrice: Double?, tags: [String]) {
        self.title = title
        self.description = description
        self.suggestedPrice = suggestedPrice
        self.tags = tags
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

    public func createListing(from draft: ListingDraft) async throws -> ListingDetail {
        let payload = draft.payload(includeUploadTokens: true)
        let result = try runtime.call(function: "ListItCore.api.createListing", with: [payload])
        guard let dictionary = result.toDictionary() as? [String: Any], let detail = ListingDetail(dictionary: dictionary) else {
            throw SharedRuntimeError.javascript(message: "Invalid create listing response")
        }
        return detail
    }

    public func updateListing(id: String, with draft: ListingDraft) async throws -> ListingDetail {
        let payload = draft.payload(includeUploadTokens: !draft.uploadTokens.isEmpty)
        let result = try runtime.call(function: "ListItCore.api.updateListing", with: [id, payload])
        guard let dictionary = result.toDictionary() as? [String: Any], let detail = ListingDetail(dictionary: dictionary) else {
            throw SharedRuntimeError.javascript(message: "Invalid update listing response")
        }
        return detail
    }

    public func fetchListingImages(id: String, minimumCount: Int = 0) async throws -> [String] {
        let result = try runtime.call(function: "ListItCore.api.getListingImages", with: [id])
        guard let array = result.toArray() as? [Any] else { return [] }
        let urls = array.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if urls.count >= minimumCount { return urls }
        return urls
    }

    public func fetchCovers(for listingIDs: [String]) async throws -> [String: String] {
        let orderedIDs = NSOrderedSet(array: listingIDs.filter { !$0.isEmpty })
        let uniqueIDs = orderedIDs.compactMap { $0 as? String }
        guard !uniqueIDs.isEmpty else { return [:] }
        let result = try runtime.call(function: "ListItCore.api.getCoversBatch", with: [uniqueIDs, ["silent": true]])
        guard let array = result.toArray() as? [Any] else { return [:] }
        var mapping: [String: String] = [:]
        for element in array {
            guard let dictionary = element as? [String: Any] else { continue }
            let idValue = dictionary["id"]
            let id: String
            if let stringID = idValue as? String {
                id = stringID
            } else if let numberID = idValue as? NSNumber {
                id = numberID.stringValue
            } else if let convertible = idValue as? CustomStringConvertible {
                id = convertible.description
            } else {
                continue
            }
            if let image = dictionary["image_data"] as? String, !image.isEmpty {
                mapping[id] = image
            }
        }
        return mapping
    }

    public func analyze(images: [URL], hint: String?) async throws -> ListingAIAnalysis {
        let payload: [String: Any] = [
            "images": images.map { $0.absoluteString },
            "hint": hint ?? ""
        ]
        let result = try runtime.call(function: "ListItCore.api.aiAnalyze", with: [payload])
        guard let dictionary = result.toDictionary() as? [String: Any] else {
            throw SharedRuntimeError.javascript(message: "Invalid AI analysis response")
        }

        let resolvedTitle = (dictionary["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let resolvedDescription = (dictionary["description"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        let price: Double?
        if let number = dictionary["suggested_price"] as? NSNumber {
            price = number.doubleValue
        } else if let priceString = dictionary["suggested_price"] as? String, let parsed = Double(priceString) {
            price = parsed
        } else {
            price = nil
        }

        let tags: [String]
        if let array = dictionary["tags"] as? [Any] {
            tags = array.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        } else if let tagsString = dictionary["tags"] as? String {
            tags = tagsString
                .split(separator: ',')
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        } else {
            tags = []
        }

        return ListingAIAnalysis(title: resolvedTitle, description: resolvedDescription, suggestedPrice: price, tags: tags)
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
