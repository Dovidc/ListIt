import Foundation
import XCTest
@testable import SharedCoreBridge

final class SharedCoreBridgeBootstrapTests: XCTestCase {
    func testUsesInjectedBundleProvider() async throws {
        let provider = SpyBundleProvider(script: "function hello() { return 'world'; }")
        let bootstrap = SharedCoreBridgeBootstrap(bundleProvider: provider)
        let runtime = SpyRuntime()
        SharedRuntimeRegistry.shared.register(runtime: runtime)
        let configuration = TestEnvironmentConfiguration()

        try await bootstrap.ensureBundleLoaded(using: configuration)

        XCTAssertEqual(provider.loadCallCount, 1)
        XCTAssertEqual(runtime.evaluatedScripts.first, "function hello() { return 'world'; }")
    }
}

private final class SpyBundleProvider: SharedCoreBundleProviding {
    private(set) var loadCallCount = 0
    private let script: String

    init(script: String) {
        self.script = script
    }

    func loadScript(named bundleName: String, configuration: EnvironmentConfigurationProviding) throws -> String {
        loadCallCount += 1
        return script
    }
}

private final class SpyRuntime: SharedRuntime {
    private(set) var evaluatedScripts: [String] = []

    override func evaluate(_ script: String) throws {
        evaluatedScripts.append(script)
    }

    override func installNativeBridge(_ bridge: SharedCoreNativeBridge) {
        // No-op for tests
    }
}

private struct TestEnvironmentConfiguration: EnvironmentConfigurationProviding {
    var sharedCoreBundleName: String { "listit-core" }
    var nativeBridge: SharedCoreNativeBridge { SharedCoreNativeBridge(environment: self) }
    var apiBaseURL: URL { URL(string: "https://example.com")! }
    var websocketURL: URL { URL(string: "wss://example.com")! }
    var extraEnvironment: [String: String] { [:] }
}
