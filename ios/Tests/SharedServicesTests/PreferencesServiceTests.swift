import XCTest
@testable import SharedServices

final class PreferencesServiceTests: XCTestCase {
    func testDefaultsMatchWebExpectations() {
        let storage = MockPreferencesStore()
        let service = PreferencesService(storage: storage)

        XCTAssertFalse(service.autoListEnabled)
        XCTAssertFalse(service.aiDescriptionEnabled)
        XCTAssertFalse(service.autoPostNearbyEnabled)
        XCTAssertTrue(service.autoInquiryEnabled)
        XCTAssertFalse(service.notificationsEnabled)
    }

    func testAutoListToggleControlsInquiry() {
        let storage = MockPreferencesStore()
        let service = PreferencesService(storage: storage)

        service.setAutoInquiryEnabled(false)
        XCTAssertFalse(service.autoInquiryEnabled)

        service.setAutoListEnabled(true)
        XCTAssertTrue(service.autoListEnabled)
        XCTAssertTrue(service.autoInquiryEnabled)

        service.setAutoListEnabled(false)
        XCTAssertFalse(service.autoListEnabled)
        XCTAssertFalse(service.autoInquiryEnabled)
    }

    func testPreferenceChangesPersist() {
        let storage = MockPreferencesStore()
        let service = PreferencesService(storage: storage)

        service.setAutoListEnabled(true)
        service.setAiDescriptionEnabled(true)
        service.setAutoPostNearbyEnabled(true)
        service.setAutoInquiryEnabled(false)
        service.setNotificationsEnabled(true)

        XCTAssertEqual(storage.values["listit_auto_list"] as? Bool, true)
        XCTAssertEqual(storage.values["listit_ai_descriptions"] as? Bool, true)
        XCTAssertEqual(storage.values["listit_auto_post_nearby"] as? Bool, true)
        XCTAssertEqual(storage.values["listit_auto_inquiry"] as? Bool, false)
        XCTAssertEqual(storage.values["listit_notifications_enabled"] as? Bool, true)
    }

    func testResetRestoresDefaults() {
        let storage = MockPreferencesStore()
        let service = PreferencesService(storage: storage)

        service.setAutoListEnabled(true)
        service.setAiDescriptionEnabled(true)
        service.setAutoPostNearbyEnabled(true)
        service.setAutoInquiryEnabled(false)
        service.setNotificationsEnabled(true)

        service.reset()

        XCTAssertFalse(service.autoListEnabled)
        XCTAssertFalse(service.aiDescriptionEnabled)
        XCTAssertFalse(service.autoPostNearbyEnabled)
        XCTAssertTrue(service.autoInquiryEnabled)
        XCTAssertFalse(service.notificationsEnabled)
    }
}

private final class MockPreferencesStore: PreferencesStoring {
    var values: [String: Any] = [:]

    func bool(forKey defaultName: String) -> Bool {
        values[defaultName] as? Bool ?? false
    }

    func object(forKey defaultName: String) -> Any? {
        values[defaultName]
    }

    func set(_ value: Any?, forKey defaultName: String) {
        values[defaultName] = value
    }
}
