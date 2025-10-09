import XCTest
@testable import SharedServices
import SharedCoreBridge
import JavaScriptCore

final class ListingsServiceTests: XCTestCase {
    func testMapsListingSummaries() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let item: [String: Any] = [
            "id": "1",
            "title": "Test",
            "subtitle": "Demo",
            "priceText": "$10",
            "price": 10,
            "location": "Portland, OR",
            "description": "Sample",
            "tags": ["home", "decor"],
            "coverImage": "https://example.com/cover.jpg",
            "sellerName": "Alex",
            "sellerAvatar": "https://example.com/avatar.png",
            "createdAt": 1_700_000_000,
            "isFavorite": true,
            "isSold": false,
            "distanceText": "2 mi",
            "distanceMeters": 3218
        ]
        runtime.stubbedResponse = JSValue(object: ["items": [item], "hasNext": false], in: context)
        let persistence = FakeListingsPersistence()
        let service = ListingsService(runtime: runtime, persistence: persistence)
        let page = try waitFor { try await service.fetchListings(query: ListingsQuery(), cursor: nil, limit: 10) }
        XCTAssertEqual(page.listings.first?.title, "Test")
        XCTAssertEqual(page.listings.first?.tags, ["home", "decor"])
        XCTAssertEqual(persistence.storedListings.first?.id, "1")
        XCTAssertFalse(page.hasNext)
    }

    func testReturnsCachedListingsWhenFetchFails() throws {
        let runtime = FakeRuntime()
        runtime.stubbedError = SharedRuntimeError.missingExport(name: "listings_feed")
        let cached = [ListingSummary(id: "cached", title: "Offline", subtitle: "Cached")]
        let persistence = FakeListingsPersistence()
        persistence.stubbedCached = cached

        let service = ListingsService(runtime: runtime, persistence: persistence)
        let listings = try waitFor { try await service.fetchListings() }
        XCTAssertEqual(listings.first?.id, "cached")
    }

    func testPropagatesErrorWhenCacheIsEmpty() {
        let runtime = FakeRuntime()
        runtime.stubbedError = SharedRuntimeError.missingExport(name: "listings_feed")
        let persistence = FakeListingsPersistence()

        let service = ListingsService(runtime: runtime, persistence: persistence)
        XCTAssertThrowsError(try waitFor { try await service.fetchListings() })
    }
}

private final class FakeRuntime: SharedRuntime {
    var stubbedResponse: JSValue?
    var stubbedError: Error?

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
        if let stubbedError {
            throw stubbedError
        }
        guard let stubbedResponse else { throw SharedRuntimeError.missingExport(name: name) }
        return stubbedResponse
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
