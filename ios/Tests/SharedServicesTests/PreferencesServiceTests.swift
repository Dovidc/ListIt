import XCTest
import Combine
@testable import SharedServices

final class PreferencesServiceTests: XCTestCase {
    func testDefaultsWhenStoreEmpty() {
        let store = InMemoryPreferencesStore()
        let service = PreferencesService(store: store)

        XCTAssertFalse(service.autoListEnabled)
        XCTAssertFalse(service.aiDescriptionEnabled)
        XCTAssertFalse(service.autoPostNearbyEnabled)
        XCTAssertTrue(service.autoInquiryEnabled)
        XCTAssertTrue(service.notificationsEnabled)
    }

    func testReadsExistingValuesFromStore() {
        let store = InMemoryPreferencesStore(storage: [
            "listit_auto_list": true,
            "listit_ai_descriptions": "1",
            "listit_auto_post_nearby": NSNumber(value: true),
            "listit_auto_inquiry": "false",
            "listit_notifications_enabled": "0"
        ])

        let service = PreferencesService(store: store)

        XCTAssertTrue(service.autoListEnabled)
        XCTAssertTrue(service.aiDescriptionEnabled)
        XCTAssertTrue(service.autoPostNearbyEnabled)
        XCTAssertFalse(service.autoInquiryEnabled)
        XCTAssertFalse(service.notificationsEnabled)
    }

    func testUpdatingValuesPersistsAndPublishes() async {
        let store = InMemoryPreferencesStore()
        let service = PreferencesService(store: store)

        let autoListExpectation = expectation(description: "Auto list updated")
        let aiDescriptionExpectation = expectation(description: "AI description updated")
        let autoNearbyExpectation = expectation(description: "Auto nearby updated")
        let autoInquiryExpectation = expectation(description: "Auto inquiry updated")
        let notificationsExpectation = expectation(description: "Notifications updated")

        var cancellables: Set<AnyCancellable> = []

        service.$autoListEnabled
            .dropFirst()
            .sink { value in
                XCTAssertTrue(value)
                autoListExpectation.fulfill()
            }
            .store(in: &cancellables)

        service.$aiDescriptionEnabled
            .dropFirst()
            .sink { value in
                XCTAssertTrue(value)
                aiDescriptionExpectation.fulfill()
            }
            .store(in: &cancellables)

        service.$autoPostNearbyEnabled
            .dropFirst()
            .sink { value in
                XCTAssertTrue(value)
                autoNearbyExpectation.fulfill()
            }
            .store(in: &cancellables)

        service.$autoInquiryEnabled
            .dropFirst()
            .sink { value in
                XCTAssertFalse(value)
                autoInquiryExpectation.fulfill()
            }
            .store(in: &cancellables)

        service.$notificationsEnabled
            .dropFirst()
            .sink { value in
                XCTAssertFalse(value)
                notificationsExpectation.fulfill()
            }
            .store(in: &cancellables)

        await MainActor.run {
            service.setAutoListEnabled(true)
            service.setAiDescriptionEnabled(true)
            service.setAutoPostNearbyEnabled(true)
            service.setAutoInquiryEnabled(false)
            service.setNotificationsEnabled(false)
        }

        wait(for: [autoListExpectation, aiDescriptionExpectation, autoNearbyExpectation, autoInquiryExpectation, notificationsExpectation], timeout: 1)

        XCTAssertEqual(store.storage["listit_auto_list"] as? Bool, true)
        XCTAssertEqual(store.storage["listit_ai_descriptions"] as? Bool, true)
        XCTAssertEqual(store.storage["listit_auto_post_nearby"] as? Bool, true)
        XCTAssertEqual(store.storage["listit_auto_inquiry"] as? Bool, false)
        XCTAssertEqual(store.storage["listit_notifications_enabled"] as? Bool, false)

        cancellables.removeAll()
    }
}

private final class InMemoryPreferencesStore: PreferencesStoring {
    var storage: [String: Any]

    init(storage: [String: Any] = [:]) {
        self.storage = storage
    }

    func object(forKey key: String) -> Any? {
        storage[key]
    }

    func set(_ value: Any?, forKey key: String) {
        storage[key] = value
    }
}
