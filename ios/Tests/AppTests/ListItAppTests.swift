import XCTest
import Combine
import SharedServices
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

    func testEnvironmentUpdatesApplyThemeAndCapabilities() {
        let configuration = EnvironmentConfiguration()
        let router = MockCapabilityRouter()
        let environment = AppEnvironment(sharedRuntime: SharedRuntime(),
                                         configuration: configuration,
                                         capabilityRouter: router)

        let expectation = expectation(description: "Theme resolves from environment overrides")
        var cancellable: AnyCancellable?
        cancellable = environment.$theme
            .dropFirst()
            .sink { theme in
                XCTAssertFalse(theme.enablesLargeTitles)
                XCTAssertEqual(theme.spacing.medium, 30)
                expectation.fulfill()
            }

        configuration.loadEnvironment([
            "LISTIT_IOS_THEME_LARGE_TITLES": "false",
            "LISTIT_IOS_THEME_BASE_SPACING": "20",
            "LISTIT_IOS_ENABLE_HAPTICS": "false"
        ])

        waitForExpectations(timeout: 1)
        cancellable?.cancel()

        XCTAssertFalse(router.configuration.enablesHaptics)
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
