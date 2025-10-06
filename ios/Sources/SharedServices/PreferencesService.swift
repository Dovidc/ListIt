import Foundation
import Combine

public protocol PreferencesStoring {
    func object(forKey key: String) -> Any?
    func set(_ value: Any?, forKey key: String)
}

extension UserDefaults: PreferencesStoring {}

public final class PreferencesService: ObservableObject {
    @Published public private(set) var autoListEnabled: Bool
    @Published public private(set) var aiDescriptionEnabled: Bool
    @Published public private(set) var autoPostNearbyEnabled: Bool
    @Published public private(set) var autoInquiryEnabled: Bool
    @Published public private(set) var notificationsEnabled: Bool

    private let store: PreferencesStoring

    private enum Keys {
        static let autoList = "listit_auto_list"
        static let aiDescriptions = "listit_ai_descriptions"
        static let autoPostNearby = "listit_auto_post_nearby"
        static let autoInquiry = "listit_auto_inquiry"
        static let notifications = "listit_notifications_enabled"
    }

    public init(store: PreferencesStoring = UserDefaults.standard) {
        self.store = store
        self.autoListEnabled = Self.readToggle(forKey: Keys.autoList, defaultValue: false, store: store)
        self.aiDescriptionEnabled = Self.readToggle(forKey: Keys.aiDescriptions, defaultValue: false, store: store)
        self.autoPostNearbyEnabled = Self.readToggle(forKey: Keys.autoPostNearby, defaultValue: false, store: store)
        self.autoInquiryEnabled = Self.readToggle(forKey: Keys.autoInquiry, defaultValue: true, store: store)
        self.notificationsEnabled = Self.readToggle(forKey: Keys.notifications, defaultValue: true, store: store)
    }

    @MainActor
    public func setAutoListEnabled(_ enabled: Bool) {
        update(&autoListEnabled, key: Keys.autoList, value: enabled)
    }

    @MainActor
    public func setAiDescriptionEnabled(_ enabled: Bool) {
        update(&aiDescriptionEnabled, key: Keys.aiDescriptions, value: enabled)
    }

    @MainActor
    public func setAutoPostNearbyEnabled(_ enabled: Bool) {
        update(&autoPostNearbyEnabled, key: Keys.autoPostNearby, value: enabled)
    }

    @MainActor
    public func setAutoInquiryEnabled(_ enabled: Bool) {
        update(&autoInquiryEnabled, key: Keys.autoInquiry, value: enabled)
    }

    @MainActor
    public func setNotificationsEnabled(_ enabled: Bool) {
        update(&notificationsEnabled, key: Keys.notifications, value: enabled)
    }

    private func update(_ property: inout Bool, key: String, value: Bool) {
        guard property != value else { return }
        property = value
        store.set(value, forKey: key)
    }

    private static func readToggle(forKey key: String, defaultValue: Bool, store: PreferencesStoring) -> Bool {
        if let storedValue = store.object(forKey: key) {
            switch storedValue {
            case let number as NSNumber:
                return number.boolValue
            case let string as String:
                let normalized = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if normalized == "1" || normalized == "true" {
                    return true
                }
                if normalized == "0" || normalized == "false" {
                    return false
                }
            case let bool as Bool:
                return bool
            default:
                break
            }
        }
        return defaultValue
    }
}
