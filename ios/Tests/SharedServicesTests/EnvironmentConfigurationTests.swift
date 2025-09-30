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
}
