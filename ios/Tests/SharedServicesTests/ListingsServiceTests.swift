import XCTest
@testable import SharedServices
import SharedCoreBridge
import JavaScriptCore

final class ListingsServiceTests: XCTestCase {
    func testMapsListingSummaries() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        runtime.stubbedResponse = JSValue(object: [
            "items": [["id": "1", "title": "Test", "subtitle": "Demo", "price": 42.0, "location": "LA"]],
            "hasNext": true,
            "nextCursor": "next"
        ], in: context)
        let persistence = FakeListingsPersistence()
        let service = ListingsService(runtime: runtime, persistence: persistence)
        let page = try waitFor { try await service.fetchListings(request: ListingsRequest()) }
        let first = page.listings.first
        XCTAssertEqual(first?.title, "Test")
        XCTAssertEqual(first?.price, 42.0)
        XCTAssertEqual(page.hasNext, true)
        XCTAssertEqual(page.nextCursor, "next")
        XCTAssertEqual(persistence.storedListings.first?.id, "1")
    }

    func testForwardsRequestParametersToSharedCore() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        runtime.stubbedResponse = JSValue(object: [
            "items": [],
            "hasNext": false,
            "nextCursor": NSNull()
        ], in: context)
        let persistence = FakeListingsPersistence()
        let service = ListingsService(runtime: runtime, persistence: persistence)
        let request = ListingsRequest(query: "bike", location: "NYC", sort: .priceHigh, limit: 40, cursor: "cursor")

        _ = try waitFor { try await service.fetchListings(request: request) }

        let payload = runtime.capturedParameters as? [String: Any]
        XCTAssertEqual(payload?["query"] as? String, "bike")
        XCTAssertEqual(payload?["location"] as? String, "NYC")
        XCTAssertEqual(payload?["sort"] as? String, ListingsRequest.Sort.priceHigh.rawValue)
        XCTAssertEqual(payload?["cursor"] as? String, "cursor")
        XCTAssertEqual(payload?["limit"] as? Int, 40)
    }

    func testReturnsCachedListingsWhenFetchFails() throws {
        let runtime = FakeRuntime()
        runtime.stubbedError = SharedRuntimeError.missingExport(name: "listings_fetch")
        let cached = [ListingSummary(id: "cached", title: "Offline", subtitle: "Cached")]
        let persistence = FakeListingsPersistence()
        persistence.stubbedCached = cached

        let service = ListingsService(runtime: runtime, persistence: persistence)
        let page = try waitFor { try await service.fetchListings(request: ListingsRequest()) }
        XCTAssertEqual(page.listings.first?.id, "cached")
        XCTAssertFalse(page.hasNext)
    }

    func testPropagatesErrorWhenCacheIsEmpty() {
        let runtime = FakeRuntime()
        runtime.stubbedError = SharedRuntimeError.missingExport(name: "listings_fetch")
        let persistence = FakeListingsPersistence()

        let service = ListingsService(runtime: runtime, persistence: persistence)
        XCTAssertThrowsError(try waitFor { try await service.fetchListings(request: ListingsRequest()) })
    }
}

private final class FakeRuntime: SharedRuntime {
    var stubbedResponse: JSValue?
    var stubbedError: Error?
    var capturedParameters: Any?

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
        if let stubbedError {
            throw stubbedError
        }
        capturedParameters = arguments.first
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
