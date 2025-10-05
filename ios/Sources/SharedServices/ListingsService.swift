import Foundation
import SharedCoreBridge

public struct ListingSummary: Equatable {
    public let id: String
    public let title: String
    public let subtitle: String

    public init(id: String, title: String, subtitle: String) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
    }
}

public struct ListingsPage {
    public let rows: [Any]
    public let summaries: [ListingSummary]
    public let hasNext: Bool
    public let nextCursor: String?

    public init(rows: [Any], summaries: [ListingSummary], hasNext: Bool, nextCursor: String?) {
        self.rows = rows
        self.summaries = summaries
        self.hasNext = hasNext
        self.nextCursor = nextCursor
    }
}

public struct NearbyListingResult: Equatable {
    public let summary: ListingSummary
    public let distanceMeters: Double?

    public init(summary: ListingSummary, distanceMeters: Double?) {
        self.summary = summary
        self.distanceMeters = distanceMeters
    }
}

public struct AdminFlaggedListing: Identifiable, Equatable {
    public let id: String
    public let title: String
    public let subtitle: String
    public let reporterCount: Int?
    public let reasons: [String]

    public init(id: String, title: String, subtitle: String, reporterCount: Int?, reasons: [String]) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.reporterCount = reporterCount
        self.reasons = reasons
    }
}

public final class ListingsService {
    private let runtime: SharedRuntime
    private let client: SharedCoreClient
    private let persistence: ListingsPersisting

    public init(runtime: SharedRuntime, persistence: ListingsPersisting = CoreDataListingsPersistence()) {
        self.runtime = runtime
        self.client = SharedCoreClient(runtime: runtime)
        self.persistence = persistence
    }

    public func fetchListings(params: [String: Any] = [:], meta: SharedCoreRequestMeta? = nil) async throws -> [ListingSummary] {
        do {
            let page = try await fetchPage(params: params, meta: meta)
            if page.summaries.isEmpty {
                try persistence.clear()
            } else {
                try persistence.store(listings: page.summaries)
            }
            return page.summaries
        } catch {
            let cached = try persistence.loadListings()
            if !cached.isEmpty {
                return cached
            }
            throw error
        }
    }

    public func fetchPage(params: [String: Any] = [:], meta: SharedCoreRequestMeta? = nil) async throws -> ListingsPage {
        var arguments: [Any] = [params]
        appendMeta(&arguments, meta: meta)
        let value = try client.call("listings.fetchSummaries", arguments: arguments)
        guard let page = parsePage(from: value) else {
            return ListingsPage(rows: [], summaries: [], hasNext: false, nextCursor: nil)
        }
        return page
    }

    public func listByUser(_ userId: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> ListingsPage {
        var arguments: [Any] = [userId.description]
        appendMeta(&arguments, meta: meta)
        let response = try client.call("api.listByUser", arguments: arguments)
        return try pageFromRawResponse(response)
    }

    public func listMine(meta: SharedCoreRequestMeta? = nil) async throws -> ListingsPage {
        var arguments: [Any] = []
        appendMeta(&arguments, meta: meta)
        let response = try client.call("api.listMine", arguments: arguments)
        return try pageFromRawResponse(response)
    }

    public func listAll(_ params: Any, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [params]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.listAll", arguments: arguments)
    }

    public func listListings(params: [String: Any] = [:], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [params]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.listListings", arguments: arguments)
    }

    public func createListing(_ payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = [payload]
        appendMeta(&arguments, meta: meta)
        let value = try client.call("api.createListing", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }

    public func updateListing(id: CustomStringConvertible, payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = [id.description, payload]
        appendMeta(&arguments, meta: meta)
        let value = try client.call("api.updateListing", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }

    public func markListingSold(id: CustomStringConvertible, sold: Bool, meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = [id.description, sold]
        appendMeta(&arguments, meta: meta)
        let value = try client.call("api.markListingSold", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }

    @discardableResult
    public func deleteListing(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> Bool {
        var arguments: [Any] = [id.description]
        appendMeta(&arguments, meta: meta)
        _ = try client.call("api.deleteListing", arguments: arguments)
        return true
    }

    public func listAds(meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = []
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.listAds", arguments: arguments)
    }

    public func searchCities(_ query: String, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [query]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.searchCities", arguments: arguments)
    }

    public func getListingImages(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> [String] {
        var arguments: [Any] = [id.description]
        appendMeta(&arguments, meta: meta)
        guard let result = try client.callObject("api.getListingImages", arguments: arguments) else { return [] }
        return result as? [String] ?? []
    }

    public func getCoversBatch(ids: [CustomStringConvertible], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        let normalized = ids.map { $0.description }
        var arguments: [Any] = [normalized]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.getCoversBatch", arguments: arguments)
    }

    public func analyzeListing(payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [payload]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.aiAnalyze", arguments: arguments)
    }

    public func reverseGeocode(latitude: Double, longitude: Double, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [latitude, longitude]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.reverseGeocode", arguments: arguments)
    }

    public func listNearby(latitude: Double, longitude: Double, radiusMeters: Double? = nil, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [latitude, longitude]
        if let radiusMeters { arguments.append(radiusMeters) }
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.listNearby", arguments: arguments)
    }

    public func fetchNearbyListings(latitude: Double,
                                    longitude: Double,
                                    radiusMeters: Double? = nil,
                                    meta: SharedCoreRequestMeta? = nil) async throws -> [NearbyListingResult] {
        guard let response = try await listNearby(latitude: latitude, longitude: longitude, radiusMeters: radiusMeters, meta: meta) else {
            return []
        }
        let rows = try client.callArray("helpers.asArray", arguments: [response])
        return rows.compactMap { raw -> NearbyListingResult? in
            guard let summary = summary(from: raw) else { return nil }
            let distance: Double?
            if let dictionary = raw as? [String: Any] {
                distance = distanceMeters(from: dictionary)
            } else {
                distance = nil
            }
            return NearbyListingResult(summary: summary, distanceMeters: distance)
        }
    }

    public func reportSeller(payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [payload]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.reportSeller", arguments: arguments)
    }

    public func formatCurrency(_ value: Any?, currency: String = "USD") throws -> String {
        var arguments: [Any] = []
        if let value { arguments.append(value) }
        arguments.append(currency)
        return try client.callString("helpers.formatCurrency", arguments: arguments)
    }

    public func formatDistance(_ meters: Double?) throws -> String {
        var arguments: [Any] = []
        if let meters { arguments.append(meters) }
        return try client.callString("helpers.formatDistance", arguments: arguments)
    }

    public func haversineMeters(from start: (Double, Double), to end: (Double, Double)) throws -> Double {
        let value = try client.call("helpers.haversineMeters", arguments: [start.0, start.1, end.0, end.1])
        return value.toDouble()
    }

    public func normalizeListingsResponse(_ value: Any, limit: Int? = nil) throws -> [String: Any] {
        var arguments: [Any] = [value]
        if let limit { arguments.append(limit) }
        return try client.callDictionary("helpers.normalizeListingsResponse", arguments: arguments)
    }

    public func asArray(_ value: Any?) throws -> [Any] {
        var arguments: [Any] = []
        if let value { arguments.append(value) }
        return try client.callArray("helpers.asArray", arguments: arguments)
    }

    @discardableResult
    public func adminDeleteListing(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> Bool {
        var arguments: [Any] = [id.description]
        appendMeta(&arguments, meta: meta)
        _ = try client.call("api.adminDeleteListing", arguments: arguments)
        return true
    }

    public func adminDeleteAll(meta: SharedCoreRequestMeta? = nil) async throws {
        var arguments: [Any] = []
        appendMeta(&arguments, meta: meta)
        _ = try client.call("api.adminDeleteAll", arguments: arguments)
    }

    public func adminSeedListings(payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [payload]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminSeedListings", arguments: arguments)
    }

    public func adminDeleteSeedListings(meta: SharedCoreRequestMeta? = nil) async throws {
        var arguments: [Any] = []
        appendMeta(&arguments, meta: meta)
        _ = try client.call("api.adminDeleteSeedListings", arguments: arguments)
    }

    public func adminListFlagged(meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = []
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminListFlagged", arguments: arguments)
    }

    public func fetchFlaggedListings(meta: SharedCoreRequestMeta? = nil) async throws -> [AdminFlaggedListing] {
        guard let response = try await adminListFlagged(meta: meta) else { return [] }
        let rows = try client.callArray("helpers.asArray", arguments: [response])
        return rows.compactMap { raw -> AdminFlaggedListing? in
            guard let dictionary = raw as? [String: Any] else { return nil }
            guard let identifier = stringIdentifier(from: dictionary["id"]) ?? stringIdentifier(from: dictionary["listing_id"]) else {
                return nil
            }

            let summary = listingSummary(from: dictionary) ?? ListingSummary(
                id: identifier,
                title: (dictionary["listing_title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ??
                    (dictionary["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ??
                    "Listing #\(identifier)",
                subtitle: (dictionary["username"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            )

            let reporterCount = integerValue(from: dictionary["report_count"]) ??
                integerValue(from: dictionary["reports"]) ??
                integerValue(from: dictionary["reportCount"])

            let subtitle = makeFlaggedSubtitle(from: dictionary, fallback: summary.subtitle)
            let reasons = reasons(from: dictionary)

            return AdminFlaggedListing(
                id: identifier,
                title: summary.title,
                subtitle: subtitle,
                reporterCount: reporterCount,
                reasons: reasons
            )
        }
    }

    public func adminDeleteFlagged(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws {
        var arguments: [Any] = [id.description]
        appendMeta(&arguments, meta: meta)
        _ = try client.call("api.adminDeleteFlagged", arguments: arguments)
    }

    public func adminListAds(meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = []
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminListAds", arguments: arguments)
    }

    public func adminCreateAd(payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [payload]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminCreateAd", arguments: arguments)
    }

    public func adminUpdateAd(id: CustomStringConvertible, payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [id.description, payload]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminUpdateAd", arguments: arguments)
    }

    public func adminDeleteAd(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws {
        var arguments: [Any] = [id.description]
        appendMeta(&arguments, meta: meta)
        _ = try client.call("api.adminDeleteAd", arguments: arguments)
    }

    public func adminSearchUsers(params: [String: Any] = [:], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [params]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminSearchUsers", arguments: arguments)
    }

    public func adminGetUser(id: CustomStringConvertible, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [id.description]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminGetUser", arguments: arguments)
    }

    public func adminGetUserReports(id: CustomStringConvertible, params: [String: Any] = [:], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [id.description, params]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminGetUserReports", arguments: arguments)
    }

    public func adminUpdateUserStatus(id: CustomStringConvertible, payload: [String: Any] = [:], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [id.description, payload]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminUpdateUserStatus", arguments: arguments)
    }

    public func adminTopReports(params: [String: Any] = [:], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [params]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminTopReports", arguments: arguments)
    }

    public func adminClearUserReports(id: CustomStringConvertible, payload: [String: Any] = [:], meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = [id.description, payload]
        appendMeta(&arguments, meta: meta)
        return try client.callObject("api.adminClearUserReports", arguments: arguments)
    }

    private func appendMeta(_ arguments: inout [Any], meta: SharedCoreRequestMeta?) {
        guard let dictionary = meta?.toDictionary(), !dictionary.isEmpty else { return }
        arguments.append(dictionary)
    }

    private func parsePage(from value: JSValue) -> ListingsPage? {
        guard let dictionary = value.toDictionary() as? [String: Any] else { return nil }
        let rows = dictionary["rows"] as? [Any] ?? []
        let hasNext = dictionary["hasNext"] as? Bool ?? false
        let nextCursor = stringIdentifier(from: dictionary["nextCursor"]) ?? stringIdentifier(from: dictionary["cursor"]) ?? stringIdentifier(from: dictionary["next_cursor"])
        let itemDictionaries = dictionary["items"] as? [[String: Any]] ?? []
        let summaries = makeSummaries(from: itemDictionaries, fallbackRows: rows)
        return ListingsPage(rows: rows, summaries: summaries, hasNext: hasNext, nextCursor: nextCursor)
    }

    private func pageFromRawResponse(_ value: JSValue) throws -> ListingsPage {
        let payload = value.toObject() ?? NSNull()
        let normalizedValue = try client.call("listings.normalize", arguments: [payload])
        return parsePage(from: normalizedValue) ?? ListingsPage(rows: [], summaries: [], hasNext: false, nextCursor: nil)
    }

    private func makeSummaries(from items: [[String: Any]], fallbackRows: [Any]) -> [ListingSummary] {
        if !items.isEmpty {
            return items.compactMap { listingSummary(from: $0) }
        }
        if !fallbackRows.isEmpty {
            return fallbackRows.compactMap { summary(from: $0) }
        }
        return []
    }

    private func summary(from raw: Any) -> ListingSummary? {
        do {
            let value = try client.call("listings.toSummary", arguments: [raw])
            guard let dictionary = value.toDictionary() as? [String: Any] else { return nil }
            return listingSummary(from: dictionary)
        } catch {
            return nil
        }
    }

    private func listingSummary(from dictionary: [String: Any]) -> ListingSummary? {
        guard let id = stringIdentifier(from: dictionary["id"]) ?? stringIdentifier(from: dictionary["uuid"]) else {
            return nil
        }
        let title = (dictionary["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let subtitle = (dictionary["subtitle"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return ListingSummary(
            id: id,
            title: title?.isEmpty == false ? title! : "Untitled",
            subtitle: subtitle ?? ""
        )
    }

    private func stringIdentifier(from value: Any?) -> String? {
        switch value {
        case let string as String where !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty:
            return string.trimmingCharacters(in: .whitespacesAndNewlines)
        case let number as NSNumber:
            return number.stringValue
        default:
            return nil
        }
    }

    private func distanceMeters(from dictionary: [String: Any]) -> Double? {
        if let nested = dictionary["distance"] as? [String: Any] {
            if let meters = nested["meters"] {
                return doubleValue(from: meters)
            }
        }
        if let meters = dictionary["distance_meters"] ?? dictionary["distanceMeters"] ?? dictionary["distance"] {
            return doubleValue(from: meters)
        }
        return nil
    }

    private func doubleValue(from value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String, let double = Double(string) { return double }
        return nil
    }

    private func integerValue(from value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String, let int = Int(string) { return int }
        return nil
    }

    private func makeFlaggedSubtitle(from dictionary: [String: Any], fallback: String) -> String {
        var components: [String] = []

        if let reporter = stringIdentifier(from: dictionary["username"]) ??
            stringIdentifier(from: dictionary["reported_by"]) ??
            stringIdentifier(from: dictionary["reporter_name"]) {
            components.append("Reporter: \(reporter)")
        }

        if let flaggedDescription = formattedFlaggedDate(from: dictionary["flagged_at"]) {
            components.append(flaggedDescription)
        }

        if components.isEmpty {
            return fallback
        }
        return components.joined(separator: " • ")
    }

    private func formattedFlaggedDate(from value: Any?) -> String? {
        guard let date = date(from: value) else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func date(from value: Any?) -> Date? {
        if let date = value as? Date { return date }
        if let number = value as? TimeInterval { return Date(timeIntervalSince1970: number) }
        if let string = value as? String {
            let isoFormatter = ISO8601DateFormatter()
            if let parsed = isoFormatter.date(from: string) { return parsed }
            if let interval = TimeInterval(string) { return Date(timeIntervalSince1970: interval) }
        }
        return nil
    }

    private func reasons(from dictionary: [String: Any]) -> [String] {
        if let reasons = dictionary["reasons"] as? [String] {
            return reasons.compactMap { reason in
                let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
        }

        if let reason = dictionary["reason"] as? String {
            let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return [trimmed] }
        }

        if let reason = dictionary["report_reason"] as? String {
            let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return [trimmed] }
        }

        if let detail = dictionary["detail"] as? [String: Any] {
            var collected: [String] = []
            if let categories = detail["categories"] as? [String] {
                collected.append(contentsOf: categories.compactMap { category in
                    let trimmed = category.trimmingCharacters(in: .whitespacesAndNewlines)
                    return trimmed.isEmpty ? nil : trimmed
                })
            }
            if let reason = detail["reason"] as? String {
                let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { collected.append(trimmed) }
            }
            if let type = detail["type"] as? String {
                let trimmed = type.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { collected.append(trimmed.capitalized) }
            }
            return Array(Set(collected))
        }

        return []
    }
}
