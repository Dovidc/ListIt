import XCTest
@testable import SharedServices
import SharedCoreBridge
import JavaScriptCore

final class NearbyServiceTests: XCTestCase {
    func testMapsNearbySummaries() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let payload: [[String: Any]] = [[
            "id": "listing-1",
            "title": "Vintage camera",
            "subtitle": "$120 • Capitol Hill",
            "distanceText": "1.2 mi",
            "distanceMeters": 1931.0,
            "location": "Seattle, WA",
            "price": 120,
            "tags": ["boosted", "favorite"],
            "createdAt": 1_700_000_000,
            "isBoosted": true,
            "isFavorite": true
        ]]
        runtime.stubbedResponse = JSValue(object: payload, in: context)

        let service = NearbyService(runtime: runtime)
        let listings = try waitFor {
            try await service.fetchNearby(latitude: 47.6, longitude: -122.3, radiusMeters: 1_609, query: "camera", filter: "newest")
        }

        XCTAssertEqual(listings.count, 1)
        let listing = try XCTUnwrap(listings.first)
        XCTAssertEqual(listing.id, "listing-1")
        XCTAssertEqual(listing.title, "Vintage camera")
        XCTAssertEqual(listing.subtitle, "$120 • Capitol Hill")
        XCTAssertEqual(listing.distanceText, "1.2 mi")
        XCTAssertEqual(listing.distanceMeters, 1931)
        XCTAssertEqual(listing.location, "Seattle, WA")
        XCTAssertEqual(listing.price, 120)
        XCTAssertEqual(listing.tags, ["boosted", "favorite"])
        XCTAssertEqual(listing.createdAt, Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertTrue(listing.isBoosted)
        XCTAssertTrue(listing.isFavorite)
    }

    func testHandlesNonArrayResponses() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        runtime.stubbedResponse = JSValue(object: ["message": "ok"], in: context)

        let service = NearbyService(runtime: runtime)
        let listings = try waitFor {
            try await service.fetchNearby(latitude: 0, longitude: 0, radiusMeters: 100)
        }

        XCTAssertTrue(listings.isEmpty)
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
