import XCTest
@testable import ListItApp
import SharedCoreBridge
import PlatformCapabilities

final class ListItAppTests: XCTestCase {
    func testAppEnvironmentInitializesServices() {
        let environment = AppEnvironment(sharedRuntime: SharedRuntime())
        XCTAssertNotNil(environment.authService)
        XCTAssertNotNil(environment.listingsService)
        XCTAssertNotNil(environment.uploadService)
    }

    func testEmitCapabilityEventRoutesToRouter() {
        let router = MockCapabilityRouter()
        let environment = AppEnvironment(sharedRuntime: SharedRuntime(), capabilityRouter: router)
        environment.emitCapabilityEvent("haptic", payload: ["style": "success"])
        XCTAssertEqual(router.events.count, 1)
        XCTAssertEqual(router.events.first?.name, "haptic")
    }
}

private final class MockCapabilityRouter: CapabilityRouting {
    struct Event: Equatable {
        let name: String
        let payload: [String: Any]
    }

    private(set) var configuration = CapabilityConfiguration()
    private(set) var events: [Event] = []

    func updateConfiguration(_ configuration: CapabilityConfiguration) {
        self.configuration = configuration
    }

    func handle(event: CapabilityEvent) {
        events.append(Event(name: event.name, payload: event.payload))
    }
}
