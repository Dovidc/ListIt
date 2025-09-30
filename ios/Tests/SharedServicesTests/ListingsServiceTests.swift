import XCTest
@testable import SharedServices
import SharedCoreBridge
import JavaScriptCore

final class ListingsServiceTests: XCTestCase {
    func testMapsListingSummaries() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        runtime.stubbedResponse = JSValue(object: [["id": "1", "title": "Test", "subtitle": "Demo"]], in: context)
        let service = ListingsService(runtime: runtime)
        let listings = try waitFor { try await service.fetchListings() }
        XCTAssertEqual(listings.first?.title, "Test")
    }
}

private final class FakeRuntime: SharedRuntime {
    var stubbedResponse: JSValue?

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
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
