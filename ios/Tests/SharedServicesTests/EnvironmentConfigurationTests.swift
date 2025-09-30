import XCTest
@testable import SharedServices
import DesignSystem

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

    func testDesignSystemThemeRespectsEnvironment() {
        let configuration = EnvironmentConfiguration()
        configuration.loadEnvironment(
            [
                "LISTIT_IOS_THEME_PRIMARY": "#000000",
                "LISTIT_IOS_THEME_BASE_SPACING": "20",
                "LISTIT_IOS_THEME_CORNER_RADIUS": "14",
                "LISTIT_IOS_THEME_LARGE_TITLES": "false",
                "LISTIT_IOS_THEME_ON_PRIMARY": "#FFEE00",
                "LISTIT_IOS_THEME_ON_SURFACE": "#333333"
            ]
        )

        let theme = configuration.designSystemTheme()
        XCTAssertEqual(theme.palette.primary, Color(hex: "#000000"))
        XCTAssertEqual(theme.spacing.medium, 30)
        XCTAssertEqual(theme.corners.medium, 14)
        XCTAssertFalse(theme.enablesLargeTitles)
        XCTAssertEqual(theme.palette.onPrimary, Color(hex: "#FFEE00"))
        XCTAssertEqual(theme.palette.onSurface, Color(hex: "#333333"))
    }

    func testCapabilityConfigurationRespectsEnvironmentFlags() {
        let configuration = EnvironmentConfiguration()
        configuration.loadEnvironment(
            [
                "LISTIT_IOS_ENABLE_HAPTICS": "false",
                "LISTIT_IOS_ENABLE_LIVE_ACTIVITIES": "0",
                "LISTIT_IOS_ENABLE_WIDGETS": "true",
                "LISTIT_IOS_ENABLE_SIRI_INTENTS": "yes"
            ]
        )

        let capabilityConfiguration = configuration.capabilityConfiguration()
        XCTAssertFalse(capabilityConfiguration.enablesHaptics)
        XCTAssertFalse(capabilityConfiguration.enablesLiveActivities)
        XCTAssertTrue(capabilityConfiguration.enablesWidgets)
        XCTAssertTrue(capabilityConfiguration.enablesIntents)
    }

    func testCapabilityEventHandlerIsInvoked() {
        let configuration = EnvironmentConfiguration()
        var received = [String: Any]()
        configuration.setCapabilityEventHandler { name, payload in
            received = payload
            XCTAssertEqual(name, "haptic")
        }

        let bridge = configuration.nativeBridge
        bridge.emitEvent("haptic", payload: ["style": "success"])
        XCTAssertEqual(received["style"] as? String, "success")
    }
}
