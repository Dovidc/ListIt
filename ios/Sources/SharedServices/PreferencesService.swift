import Foundation
import Combine

@MainActor
public final class PreferencesService: ObservableObject {
    private enum Keys {
        static let autoList = "listit_auto_list"
        static let aiDescriptions = "listit_ai_descriptions"
        static let autoPostNearby = "listit_auto_post_nearby"
        static let autoInquiry = "listit_auto_inquiry"
        static let notifications = "listit_notifications_enabled"
    }

    @Published public private(set) var autoListEnabled: Bool
    @Published public private(set) var aiDescriptionEnabled: Bool
    @Published public private(set) var autoPostNearbyEnabled: Bool
    @Published public private(set) var autoInquiryEnabled: Bool
    @Published public private(set) var notificationsEnabled: Bool

    private let storage: PreferencesStoring

    public init(storage: PreferencesStoring = UserDefaults.standard) {
        self.storage = storage

        autoListEnabled = storage.bool(forKey: Keys.autoList)
        aiDescriptionEnabled = storage.bool(forKey: Keys.aiDescriptions)
        autoPostNearbyEnabled = storage.bool(forKey: Keys.autoPostNearby)
        if storage.object(forKey: Keys.autoInquiry) == nil {
            autoInquiryEnabled = true
        } else {
            autoInquiryEnabled = storage.bool(forKey: Keys.autoInquiry)
        }
        notificationsEnabled = storage.bool(forKey: Keys.notifications)
    }

    public func setAutoListEnabled(_ isEnabled: Bool) {
        guard autoListEnabled != isEnabled else { return }
        autoListEnabled = isEnabled
        storage.set(isEnabled, forKey: Keys.autoList)

        if isEnabled {
            if autoInquiryEnabled == false {
                setAutoInquiryEnabled(true)
            }
        } else {
            setAutoInquiryEnabled(false)
        }
    }

    public func setAiDescriptionEnabled(_ isEnabled: Bool) {
        guard aiDescriptionEnabled != isEnabled else { return }
        aiDescriptionEnabled = isEnabled
        storage.set(isEnabled, forKey: Keys.aiDescriptions)
    }

    public func setAutoPostNearbyEnabled(_ isEnabled: Bool) {
        guard autoPostNearbyEnabled != isEnabled else { return }
        autoPostNearbyEnabled = isEnabled
        storage.set(isEnabled, forKey: Keys.autoPostNearby)
    }

    public func setAutoInquiryEnabled(_ isEnabled: Bool) {
        guard autoInquiryEnabled != isEnabled else { return }
        autoInquiryEnabled = isEnabled
        storage.set(isEnabled, forKey: Keys.autoInquiry)
    }

    public func setNotificationsEnabled(_ isEnabled: Bool) {
        guard notificationsEnabled != isEnabled else { return }
        notificationsEnabled = isEnabled
        storage.set(isEnabled, forKey: Keys.notifications)
    }

    public func reset() {
        autoListEnabled = false
        aiDescriptionEnabled = false
        autoPostNearbyEnabled = false
        autoInquiryEnabled = true
        notificationsEnabled = false

        storage.set(false, forKey: Keys.autoList)
        storage.set(false, forKey: Keys.aiDescriptions)
        storage.set(false, forKey: Keys.autoPostNearby)
        storage.set(true, forKey: Keys.autoInquiry)
        storage.set(false, forKey: Keys.notifications)
    }
}

public protocol PreferencesStoring: AnyObject {
    func bool(forKey defaultName: String) -> Bool
    func object(forKey defaultName: String) -> Any?
    func set(_ value: Any?, forKey defaultName: String)
}

extension UserDefaults: PreferencesStoring {}
