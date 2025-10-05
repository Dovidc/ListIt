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
