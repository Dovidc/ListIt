import Foundation
import SharedCoreBridge

public struct NearbyListingSummary: Equatable {
    public let id: String
    public let title: String
    public let subtitle: String
    public let distanceText: String
    public let distanceMeters: Double?
    public let location: String?
    public let price: Double?
    public let tags: [String]
    public let createdAt: Date?
    public let isBoosted: Bool
    public let isFavorite: Bool

    public init(id: String,
                title: String,
                subtitle: String,
                distanceText: String,
                distanceMeters: Double?,
                location: String?,
                price: Double?,
                tags: [String],
                createdAt: Date?,
                isBoosted: Bool,
                isFavorite: Bool) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.distanceText = distanceText
        self.distanceMeters = distanceMeters
        self.location = location
        self.price = price
        self.tags = tags
        self.createdAt = createdAt
        self.isBoosted = isBoosted
        self.isFavorite = isFavorite
    }
}

public final class NearbyService {
    private let runtime: SharedRuntime

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
    }

    public func fetchNearby(latitude: Double,
                            longitude: Double,
                            radiusMeters: Double,
                            query: String? = nil,
                            filter: String? = nil) async throws -> [NearbyListingSummary] {
        var payload: [String: Any] = [
            "lat": latitude,
            "lon": longitude,
            "radius_m": radiusMeters
        ]

        if let trimmedQuery = query?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmedQuery.isEmpty {
            payload["query"] = trimmedQuery
        }

        if let filter, !filter.isEmpty {
            payload["filter"] = filter
        }

        let response = try runtime.call(function: "nearby_fetch", with: [payload])
        guard let array = response.toArray() else {
            return []
        }

        let contexts = array.compactMap { element -> [String: Any]? in
            if let dictionary = element as? [String: Any] {
                return dictionary
            }
            if let dictionary = element as? NSDictionary {
                return dictionary as? [String: Any]
            }
            return nil
        }

        return contexts.compactMap(NearbyListingSummary.init(dictionary:))
    }
}

private extension NearbyListingSummary {
    init?(dictionary: [String: Any]) {
        guard let id = NearbyListingSummary.parseIdentifier(dictionary["id"]) else { return nil }

        let title = NearbyListingSummary.parseString(dictionary["title"]) ?? "Untitled"
        let subtitle = NearbyListingSummary.parseString(dictionary["subtitle"]) ?? ""
        let distanceText = NearbyListingSummary.parseString(dictionary["distanceText"]) ?? ""
        let distanceMeters = NearbyListingSummary.parseNumber(dictionary["distanceMeters"])
        let location = NearbyListingSummary.parseString(dictionary["location"])
        let price = NearbyListingSummary.parseNumber(dictionary["price"])
        let tags = NearbyListingSummary.parseTags(dictionary["tags"])
        let createdAt = NearbyListingSummary.parseDate(dictionary["createdAt"])
        let isBoosted = NearbyListingSummary.parseBool(dictionary["isBoosted"])
        let isFavorite = NearbyListingSummary.parseBool(dictionary["isFavorite"])

        self.init(id: id,
                  title: title,
                  subtitle: subtitle,
                  distanceText: distanceText,
                  distanceMeters: distanceMeters,
                  location: location,
                  price: price,
                  tags: tags,
                  createdAt: createdAt,
                  isBoosted: isBoosted,
                  isFavorite: isFavorite)
    }

    static func parseIdentifier(_ value: Any?) -> String? {
        if let string = value as? String, !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return string
        }
        if let number = value as? NSNumber {
            return number.stringValue
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

    static func parseNumber(_ value: Any?) -> Double? {
        guard let value else { return nil }
        if let number = value as? NSNumber {
            return number.doubleValue
        }
        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, let parsed = Double(trimmed) else { return nil }
            return parsed
        }
        if let date = value as? Date {
            return date.timeIntervalSince1970
        }
        return nil
    }

    static func parseTags(_ value: Any?) -> [String] {
        guard let value else { return [] }
        if let tags = value as? [String] {
            return tags.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
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

    static func parseBool(_ value: Any?) -> Bool {
        guard let value else { return false }
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let string = value as? String {
            let normalized = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return ["1", "true", "yes", "y"].contains(normalized)
        }
        return false
    }

    static func parseDate(_ value: Any?) -> Date? {
        guard let value else { return nil }
        if let date = value as? Date { return date }
        if let number = value as? NSNumber {
            let seconds = number.doubleValue
            if seconds > 1_000_000_000_000 {
                return Date(timeIntervalSince1970: seconds / 1000)
            }
            return Date(timeIntervalSince1970: seconds)
        }
        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return nil }
            if let numeric = Double(trimmed) {
                if numeric > 1_000_000_000_000 {
                    return Date(timeIntervalSince1970: numeric / 1000)
                }
                return Date(timeIntervalSince1970: numeric)
            }
            if let parsed = ISO8601Cache.fractional.date(from: trimmed) {
                return parsed
            }
            if let parsed = ISO8601Cache.basic.date(from: trimmed) {
                return parsed
            }
        }
        return nil
    }
}

private enum ISO8601Cache {
    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let basic: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
