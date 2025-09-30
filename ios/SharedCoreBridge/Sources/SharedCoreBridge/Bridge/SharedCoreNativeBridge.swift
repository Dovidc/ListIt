import Foundation
import JavaScriptCore

public typealias SharedCoreEventHandler = (String, [String: Any]) -> Void

@objc
public protocol SharedCoreNativeBridgeExport: JSExport {
    func fetchEnv(_ key: String) -> String?
    func log(_ message: String)
    func emitEvent(_ name: String, payload: [String: Any]?)
}

@objc
public final class SharedCoreNativeBridge: NSObject, SharedCoreNativeBridgeExport {
    private let environment: EnvironmentConfigurationProviding
    private let eventHandler: SharedCoreEventHandler?

    public init(environment: EnvironmentConfigurationProviding, eventHandler: SharedCoreEventHandler? = nil) {
        self.environment = environment
        self.eventHandler = eventHandler
    }

    public func fetchEnv(_ key: String) -> String? {
        environment.value(for: key)
    }

    public func log(_ message: String) {
        print("[SharedCore] \(message)")
    }

    public func emitEvent(_ name: String, payload: [String: Any]?) {
        eventHandler?(name, payload ?? [:])
    }
}

public extension EnvironmentConfigurationProviding {
    func value(for key: String) -> String? {
        switch key {
        case "API_BASE_URL":
            return apiBaseURL.absoluteString
        case "WEBSOCKET_URL":
            return websocketURL.absoluteString
        default:
            return extraEnvironment[key]
        }
    }

    var apiBaseURL: URL { get }
    var websocketURL: URL { get }
    var extraEnvironment: [String: String] { get }
}
