import XCTest
@testable import SharedServices
import SharedCoreBridge
import JavaScriptCore

final class ListingsServiceTests: XCTestCase {
    func testMapsListingSummaries() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let page = JSValue(object: [
            "rows": [],
            "items": [["id": "1", "title": "Test", "subtitle": "Demo"]],
            "hasNext": false,
            "nextCursor": NSNull()
        ], in: context)
        runtime.stubbedResponses["listings.fetchSummaries"] = page
        let persistence = FakeListingsPersistence()
        let service = ListingsService(runtime: runtime, persistence: persistence)
        let listings = try waitFor { try await service.fetchListings() }
        XCTAssertEqual(listings.first?.title, "Test")
        XCTAssertEqual(persistence.storedListings.first?.id, "1")
    }

    func testReturnsCachedListingsWhenFetchFails() throws {
        let runtime = FakeRuntime()
        runtime.stubbedError = SharedRuntimeError.javascript(message: "boom")
        let cached = [ListingSummary(id: "cached", title: "Offline", subtitle: "Cached")]
        let persistence = FakeListingsPersistence()
        persistence.stubbedCached = cached

        let service = ListingsService(runtime: runtime, persistence: persistence)
        let listings = try waitFor { try await service.fetchListings() }
        XCTAssertEqual(listings.first?.id, "cached")
    }

    func testPropagatesErrorWhenCacheIsEmpty() {
        let runtime = FakeRuntime()
        runtime.stubbedError = SharedRuntimeError.javascript(message: "fail")
        let persistence = FakeListingsPersistence()

        let service = ListingsService(runtime: runtime, persistence: persistence)
        XCTAssertThrowsError(try waitFor { try await service.fetchListings() })
    }

    func testFetchNearbyListingsReturnsDistance() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let rawListing: [String: Any] = [
            "id": "5",
            "title": "Cafe",
            "subtitle": "Downtown",
            "distance_meters": 120.0
        ]

        runtime.stubbedResponses["api.listNearby"] = JSValue(object: [rawListing], in: context)
        runtime.stubbedResponses["helpers.asArray"] = JSValue(object: [rawListing], in: context)
        runtime.stubbedResponses["listings.toSummary"] = JSValue(object: ["id": "5", "title": "Cafe", "subtitle": "Downtown"], in: context)

        let service = ListingsService(runtime: runtime, persistence: FakeListingsPersistence())
        let nearby = try waitFor { try await service.fetchNearbyListings(latitude: 0, longitude: 0) }

        XCTAssertEqual(nearby.first?.summary.id, "5")
        XCTAssertEqual(nearby.first?.distanceMeters, 120.0)
    }

    func testFetchFlaggedListingsParsesReasons() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let flagged: [String: Any] = [
            "id": 99,
            "title": "Vintage Bike",
            "username": "moderator",
            "reasons": ["spam", "offensive"],
            "report_count": 3,
            "flagged_at": ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600))
        ]

        runtime.stubbedResponses["api.adminListFlagged"] = JSValue(object: [flagged], in: context)
        runtime.stubbedResponses["helpers.asArray"] = JSValue(object: [flagged], in: context)
        runtime.stubbedResponses["listings.toSummary"] = JSValue(object: ["id": "99", "title": "Vintage Bike", "subtitle": ""], in: context)

        let service = ListingsService(runtime: runtime, persistence: FakeListingsPersistence())
        let flaggedListings = try waitFor { try await service.fetchFlaggedListings() }

        XCTAssertEqual(flaggedListings.first?.id, "99")
        XCTAssertEqual(flaggedListings.first?.reporterCount, 3)
        XCTAssertEqual(Set(flaggedListings.first?.reasons ?? []), Set(["spam", "offensive"]))
        XCTAssertTrue(flaggedListings.first?.subtitle.contains("Reporter") ?? false)
    }
}

private final class FakeRuntime: SharedRuntime {
    var stubbedResponses: [String: JSValue] = [:]
    var stubbedError: Error?

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
        if let stubbedError {
            throw stubbedError
        }
        guard name == "shared_core_call",
              let method = arguments.first as? String,
              let response = stubbedResponses[method]
        else {
            throw SharedRuntimeError.missingExport(name: name)
        }
        return response
    }
}

private final class FakeListingsPersistence: ListingsPersisting {
    var storedListings: [ListingSummary] = []
    var stubbedCached: [ListingSummary] = []

    func store(listings: [ListingSummary]) throws {
        storedListings = listings
    }

    func loadListings() throws -> [ListingSummary] {
        stubbedCached
    }

    func clear() throws {
        storedListings = []
    }
}

private func waitFor<T>(_ closure: @escaping () async throws -> T) rethrows -> T {
    let expectation = XCTestExpectation(description: "async")
    var result: Result<T, Error>!
    Task {
        do {
            result = .success(try await closure())
        } catch {
            result = .failure(error)
        }
        expectation.fulfill()
    }
    XCTWaiter().wait(for: [expectation], timeout: 1)
    return try result.get()
}
