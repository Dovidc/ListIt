import Foundation
import JavaScriptCore

@objc
public protocol SharedCoreNativeBridgeExport: JSExport {
    func fetchEnv(_ key: String) -> String?
    func log(_ message: String)
}

@objc
public final class SharedCoreNativeBridge: NSObject, SharedCoreNativeBridgeExport {
    private let environment: EnvironmentConfigurationProviding

    public init(environment: EnvironmentConfigurationProviding) {
        self.environment = environment
    }

    public func fetchEnv(_ key: String) -> String? {
        environment.value(for: key)
    }

    public func log(_ message: String) {
        print("[SharedCore] \(message)")
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
