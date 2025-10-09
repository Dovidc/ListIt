import Foundation
import UIKit

public struct CapabilityEvent {
    public let name: String
    public let payload: [String: Any]

    public init(name: String, payload: [String: Any]) {
        self.name = name
        self.payload = payload
    }
}

public struct CapabilityConfiguration: Equatable {
    public var enablesHaptics: Bool
    public var enablesLiveActivities: Bool
    public var enablesWidgets: Bool
    public var enablesIntents: Bool

    public init(enablesHaptics: Bool = true,
                enablesLiveActivities: Bool = true,
                enablesWidgets: Bool = true,
                enablesIntents: Bool = true) {
        self.enablesHaptics = enablesHaptics
        self.enablesLiveActivities = enablesLiveActivities
        self.enablesWidgets = enablesWidgets
        self.enablesIntents = enablesIntents
    }
}

public extension CapabilityConfiguration {
    static func from(environment: [String: String]) -> CapabilityConfiguration {
        func bool(for key: String, default defaultValue: Bool) -> Bool {
            guard let value = environment[key]?.lowercased() else { return defaultValue }
            switch value {
            case "false", "0", "no": return false
            case "true", "1", "yes": return true
            default: return defaultValue
            }
        }

        return CapabilityConfiguration(
            enablesHaptics: bool(for: "LISTIT_IOS_ENABLE_HAPTICS", default: true),
            enablesLiveActivities: bool(for: "LISTIT_IOS_ENABLE_LIVE_ACTIVITIES", default: true),
            enablesWidgets: bool(for: "LISTIT_IOS_ENABLE_WIDGETS", default: true),
            enablesIntents: bool(for: "LISTIT_IOS_ENABLE_SIRI_INTENTS", default: true)
        )
    }
}

public protocol CapabilityRouting {
    func updateConfiguration(_ configuration: CapabilityConfiguration)
    func handle(event: CapabilityEvent)
}

public final class CapabilityRouter: CapabilityRouting {
    private var configuration: CapabilityConfiguration
    private var haptics: HapticsProviding
    private var liveActivities: LiveActivityManaging
    private var widgets: WidgetScheduling
    private var intents: IntentHandling

    public init(configuration: CapabilityConfiguration = CapabilityConfiguration(),
                haptics: HapticsProviding = DefaultHapticsProvider(),
                liveActivities: LiveActivityManaging = DefaultLiveActivityManager(),
                widgets: WidgetScheduling = DefaultWidgetScheduler(),
                intents: IntentHandling = DefaultIntentHandler()) {
        self.configuration = configuration
        self.haptics = haptics
        self.liveActivities = liveActivities
        self.widgets = widgets
        self.intents = intents
    }

    public func updateConfiguration(_ configuration: CapabilityConfiguration) {
        self.configuration = configuration
    }

    public func handle(event: CapabilityEvent) {
        switch event.name.lowercased() {
        case "haptic":
            guard configuration.enablesHaptics else { return }
            let feedback = HapticFeedback(rawValue: (event.payload["style"] as? String) ?? "impact.medium") ?? .impact(.medium)
            haptics.trigger(feedback)
        case "liveactivity.start":
            guard configuration.enablesLiveActivities else { return }
            liveActivities.start(with: event.payload)
        case "liveactivity.update":
            guard configuration.enablesLiveActivities else { return }
            liveActivities.update(with: event.payload)
        case "liveactivity.end":
            guard configuration.enablesLiveActivities else { return }
            liveActivities.end(with: event.payload)
        case "widget.refresh":
            guard configuration.enablesWidgets else { return }
            widgets.refresh(kind: event.payload["kind"] as? String)
        case "intent.donate":
            guard configuration.enablesIntents else { return }
            intents.donate(intentIdentifier: event.payload["identifier"] as? String, payload: event.payload)
        default:
            break
        }
    }
}

public enum HapticFeedback: Equatable {
    case impact(UIImpactFeedbackGenerator.FeedbackStyle)
    case notification(UINotificationFeedbackGenerator.FeedbackType)

    init?(rawValue: String) {
        switch rawValue.lowercased() {
        case "success": self = .notification(.success)
        case "warning": self = .notification(.warning)
        case "error": self = .notification(.error)
        case "impact.light": self = .impact(.light)
        case "impact.medium": self = .impact(.medium)
        case "impact.heavy": self = .impact(.heavy)
        case "impact.soft":
            if #available(iOS 13.0, *) {
                self = .impact(.soft)
            } else {
                return nil
            }
        case "impact.rigid":
            if #available(iOS 13.0, *) {
                self = .impact(.rigid)
            } else {
                return nil
            }
        default:
            return nil
        }
    }
}

public protocol HapticsProviding {
    func trigger(_ feedback: HapticFeedback)
}

public final class DefaultHapticsProvider: HapticsProviding {
    private let notificationGenerator = UINotificationFeedbackGenerator()

    public init() {}

    public func trigger(_ feedback: HapticFeedback) {
        let triggerFeedback = { [notificationGenerator] in
            switch feedback {
            case .impact(let style):
                let generator = UIImpactFeedbackGenerator(style: style)
                generator.prepare()
                generator.impactOccurred()
            case .notification(let type):
                notificationGenerator.prepare()
                notificationGenerator.notificationOccurred(type)
            }
        }

        if Thread.isMainThread {
            triggerFeedback()
        } else {
            DispatchQueue.main.async(execute: triggerFeedback)
        }
    }
}

public protocol LiveActivityManaging {
    func start(with payload: [String: Any])
    func update(with payload: [String: Any])
    func end(with payload: [String: Any])
}

public final class DefaultLiveActivityManager: LiveActivityManaging {
    public init() {}

    public func start(with payload: [String: Any]) {
        debugPrint("LiveActivity start payload", payload)
    }

    public func update(with payload: [String: Any]) {
        debugPrint("LiveActivity update payload", payload)
    }

    public func end(with payload: [String: Any]) {
        debugPrint("LiveActivity end payload", payload)
    }
}

public protocol WidgetScheduling {
    func refresh(kind: String?)
}

public final class DefaultWidgetScheduler: WidgetScheduling {
    public init() {}

    public func refresh(kind: String?) {
        debugPrint("Widget refresh requested", kind ?? "default")
    }
}

public protocol IntentHandling {
    func donate(intentIdentifier: String?, payload: [String: Any])
}

public final class DefaultIntentHandler: IntentHandling {
    public init() {}

    public func donate(intentIdentifier: String?, payload: [String: Any]) {
        debugPrint("Intent donation", intentIdentifier ?? "unknown", payload)
    }
}
