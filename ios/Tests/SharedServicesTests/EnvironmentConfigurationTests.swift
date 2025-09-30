import XCTest
@testable import SharedServices

final class EnvironmentConfigurationTests: XCTestCase {
    func testLoadsExampleEnvWhenPrimaryMissing() throws {
        let loader = DefaultEnvironmentLoader(fileManager: .default, environment: [:])
        let values = try loader.load()
        XCTAssertEqual(values["API_BASE_URL"], "https://api.staging.listit.app")
    }

    func testAllowsOverridePathFromEnvironment() throws {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("listit-test.env")
        try "API_BASE_URL=https://override.example\n".write(to: tempURL, atomically: true, encoding: .utf8)
        let loader = DefaultEnvironmentLoader(
            fileManager: .default,
            environment: ["LISTIT_IOS_ENV_PATH": tempURL.path]
        )
        let values = try loader.load()
        XCTAssertEqual(values["API_BASE_URL"], "https://override.example")
    }

    func testLoadsVariantResourcesBasedOnEnvironmentFlag() throws {
        let bundle = Bundle(for: BundleLocator.self)
        let loader = DefaultEnvironmentLoader(
            fileManager: .default,
            environment: ["LISTIT_ENV": "production"],
            resourceBundle: bundle,
            appBundle: bundle
        )
        let values = try loader.load()
        XCTAssertEqual(values["API_BASE_URL"], "https://api.listit.app")
        XCTAssertEqual(values["WEBSOCKET_URL"], "wss://ws.listit.app")
        XCTAssertEqual(values["LISTIT_CORE_DISTRIBUTION"], "xcframework")
    }

    func testVariantSpecificOverridePathWins() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fileURL = directory.appendingPathComponent("app.production.env")
        try "API_BASE_URL=https://custom.example\n".write(to: fileURL, atomically: true, encoding: .utf8)

        let loader = DefaultEnvironmentLoader(
            fileManager: .default,
            environment: [
                "LISTIT_ENV": "production",
                "LISTIT_IOS_ENV_PATH_PRODUCTION": directory.path
            ],
            resourceBundle: Bundle(for: BundleLocator.self),
            appBundle: Bundle(for: BundleLocator.self)
        )

        let values = try loader.load()
        XCTAssertEqual(values["API_BASE_URL"], "https://custom.example")
    }
}
