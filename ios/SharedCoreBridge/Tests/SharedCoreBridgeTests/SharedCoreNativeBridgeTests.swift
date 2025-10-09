import XCTest
import SharedCoreBridge

final class SharedCoreNativeBridgeTests: XCTestCase {
    func testEmitEventInvokesHandler() {
        let expectation = expectation(description: "event")
        var received: (String, [String: Any])?
        let bridge = SharedCoreNativeBridge(environment: MockEnvironment(), eventHandler: { name, payload in
            received = (name, payload)
            expectation.fulfill()
        })

        bridge.emitEvent("haptic", payload: ["style": "success"])

        wait(for: [expectation], timeout: 1)
        XCTAssertEqual(received?.0, "haptic")
        XCTAssertEqual(received?.1["style"] as? String, "success")
    }
}

private struct MockEnvironment: EnvironmentConfigurationProviding {
    var sharedCoreBundleName: String { "mock" }
    var nativeBridge: SharedCoreNativeBridge { SharedCoreNativeBridge(environment: self) }
    var apiBaseURL: URL { URL(string: "https://example.com")! }
    var websocketURL: URL { URL(string: "wss://example.com")! }
    var extraEnvironment: [String : String] { [:] }
}
