import XCTest
@testable import SharedServices
import SharedCoreBridge
import JavaScriptCore

final class ListingsServiceTests: XCTestCase {
    func testMapsListingSummaries() throws {
        let runtime = FakeRuntime()
        runtime.stubbedResponse = JSValue(object: [["id": "1", "title": "Test", "subtitle": "Demo"]], in: runtime.jsContext)
        let persistence = FakeListingsPersistence()
        let service = ListingsService(runtime: runtime, persistence: persistence)
        let listings = try waitFor { try await service.fetchListings() }
        XCTAssertEqual(listings.first?.title, "Test")
        XCTAssertEqual(persistence.storedListings.first?.id, "1")
        XCTAssertEqual(runtime.invokedFunctions, ["listings_fetch"])
    }

    func testCachesListingsResolvedFromPromise() throws {
        let runtime = FakeRuntime()
        runtime.stubbedPromisePayload = [["id": "p", "title": "Async", "subtitle": "Promise"]]
        let persistence = FakeListingsPersistence()
        let service = ListingsService(runtime: runtime, persistence: persistence)

        let listings = try waitFor { try await service.fetchListings() }
        XCTAssertEqual(listings.first?.id, "p")
        XCTAssertEqual(persistence.storedListings.first?.title, "Async")
    }

    func testReturnsCachedListingsWhenFetchFails() throws {
        let runtime = FakeRuntime()
        runtime.stubbedError = SharedRuntimeError.missingExport(name: "listings_fetch")
        let cached = [ListingSummary(id: "cached", title: "Offline", subtitle: "Cached")]
        let persistence = FakeListingsPersistence()
        persistence.stubbedCached = cached

        let service = ListingsService(runtime: runtime, persistence: persistence)
        let listings = try waitFor { try await service.fetchListings() }
        XCTAssertEqual(listings.first?.id, "cached")
    }

    func testPropagatesErrorWhenCacheIsEmpty() {
        let runtime = FakeRuntime()
        runtime.stubbedError = SharedRuntimeError.missingExport(name: "listings_fetch")
        let persistence = FakeListingsPersistence()

        let service = ListingsService(runtime: runtime, persistence: persistence)
        XCTAssertThrowsError(try waitFor { try await service.fetchListings() })
    }
}

private final class FakeRuntime: SharedRuntime {
    let jsContext: JSContext
    var stubbedResponse: JSValue?
    var stubbedError: Error?
    var stubbedPromisePayload: Any?
    var stubbedPromiseShouldReject = false
    private(set) var invokedFunctions: [String] = []

    override init() {
        let context = JSContext()!
        self.jsContext = context
        super.init(context: context)
    }

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
        XCTFail("Expected async call for \(name)")
        throw SharedRuntimeError.missingExport(name: name)
    }

    override func callAsync(function name: String, with arguments: [Any]) async throws -> JSValue {
        invokedFunctions.append(name)
        if let stubbedError {
            throw stubbedError
        }
        if let payload = stubbedPromisePayload {
            if stubbedPromiseShouldReject {
                throw SharedRuntimeError.javascript(message: "Promise rejected")
            }
            await Task.yield()
            return JSValue(object: payload, in: jsContext) ?? JSValue(nullIn: jsContext)!
        }
        guard let stubbedResponse else { throw SharedRuntimeError.missingExport(name: name) }
        await Task.yield()
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
