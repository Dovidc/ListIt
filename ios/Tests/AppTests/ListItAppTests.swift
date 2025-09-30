import XCTest
@testable import ListItApp
import SharedCoreBridge

final class ListItAppTests: XCTestCase {
    func testAppEnvironmentInitializesServices() {
        let environment = AppEnvironment(sharedRuntime: SharedRuntime())
        XCTAssertNotNil(environment.authService)
        XCTAssertNotNil(environment.listingsService)
        XCTAssertNotNil(environment.uploadService)
    }
}
