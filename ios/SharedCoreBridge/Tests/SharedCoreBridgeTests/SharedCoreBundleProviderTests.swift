import Foundation
import XCTest
@testable import SharedCoreBridge

final class SharedCoreBundleProviderTests: XCTestCase {
    private let bundleName = "listit-core"

    func testLoadsScriptFromExplicitPath() throws {
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("js")
        try "console.log('path override');".write(to: tempURL, atomically: true, encoding: .utf8)

        let provider = SharedCoreBundleProvider(fileManager: .default, resourceBundle: .module)
        let configuration = TestEnvironmentConfiguration(extraEnvironment: [
            "LISTIT_CORE_BUNDLE_PATH": tempURL.path
        ])

        let script = try provider.loadScript(named: bundleName, configuration: configuration)
        XCTAssertTrue(script.contains("path override"))
    }

    func testLoadsScriptFromXCFrameworkPath() throws {
        let tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let xcframeworkURL = tempDirectory.appendingPathComponent("ListItCore.xcframework")
        let resourcesURL = xcframeworkURL
            .appendingPathComponent("ios-arm64")
            .appendingPathComponent("Resources")
        try FileManager.default.createDirectory(at: resourcesURL, withIntermediateDirectories: true)
        let scriptURL = resourcesURL.appendingPathComponent("\(bundleName).js")
        try "console.log('xcframework');".write(to: scriptURL, atomically: true, encoding: .utf8)

        let provider = SharedCoreBundleProvider(fileManager: .default, resourceBundle: .module)
        let configuration = TestEnvironmentConfiguration(extraEnvironment: [
            "LISTIT_CORE_DISTRIBUTION": "xcframework",
            "LISTIT_CORE_XCFRAMEWORK_PATH": xcframeworkURL.path
        ])

        let script = try provider.loadScript(named: bundleName, configuration: configuration)
        XCTAssertTrue(script.contains("xcframework"))
    }

    func testFallsBackToBundledResource() throws {
        let provider = SharedCoreBundleProvider(fileManager: .default, resourceBundle: .module)
        let configuration = TestEnvironmentConfiguration()

        let script = try provider.loadScript(named: bundleName, configuration: configuration)
        XCTAssertFalse(script.isEmpty)
    }

    func testExplicitBundlePathFailureThrows() {
        let provider = SharedCoreBundleProvider(fileManager: .default, resourceBundle: .module)
        let configuration = TestEnvironmentConfiguration(extraEnvironment: [
            "LISTIT_CORE_BUNDLE_PATH": "/path/that/does/not/exist.js"
        ])

        XCTAssertThrowsError(try provider.loadScript(named: bundleName, configuration: configuration)) { error in
            guard case BootstrapError.bundleNotFound(let name) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertEqual(name, bundleName)
        }
    }

    func testExplicitXCFrameworkPathFailureThrows() {
        let tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let provider = SharedCoreBundleProvider(fileManager: .default, resourceBundle: .module)
        let configuration = TestEnvironmentConfiguration(extraEnvironment: [
            "LISTIT_CORE_DISTRIBUTION": "xcframework",
            "LISTIT_CORE_XCFRAMEWORK_PATH": tempDirectory.path
        ])

        XCTAssertThrowsError(try provider.loadScript(named: bundleName, configuration: configuration)) { error in
            guard case BootstrapError.bundleNotFound(let name) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertEqual(name, "\(bundleName) (xcframework)")
        }
    }

    func testDistributionPreferenceWithoutBundleThrows() {
        let provider = SharedCoreBundleProvider(fileManager: .default, resourceBundle: .module)
        let configuration = TestEnvironmentConfiguration(extraEnvironment: [
            "LISTIT_CORE_DISTRIBUTION": "xcframework"
        ])

        XCTAssertThrowsError(try provider.loadScript(named: bundleName, configuration: configuration)) { error in
            guard case BootstrapError.bundleNotFound(let name) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertEqual(name, "\(bundleName) (xcframework)")
        }
    }
}

private struct TestEnvironmentConfiguration: EnvironmentConfigurationProviding {
    var sharedCoreBundleName: String { "listit-core" }
    var nativeBridge: SharedCoreNativeBridge { SharedCoreNativeBridge(environment: self) }
    var apiBaseURL: URL { URL(string: "https://example.com")! }
    var websocketURL: URL { URL(string: "wss://example.com")! }
    var extraEnvironment: [String: String]

    init(extraEnvironment: [String: String] = [:]) {
        self.extraEnvironment = extraEnvironment
    }
}
