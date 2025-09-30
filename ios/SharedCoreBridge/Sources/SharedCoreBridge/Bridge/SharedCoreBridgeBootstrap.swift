import Foundation

public actor SharedCoreBridgeBootstrap {
    public static let shared = SharedCoreBridgeBootstrap()

    private var hasLoadedBundle = false

    public func ensureBundleLoaded(using configuration: EnvironmentConfigurationProviding) async throws {
        guard !hasLoadedBundle else { return }
        let bundle = Bundle.module
        guard let scriptURL = bundle.url(forResource: configuration.sharedCoreBundleName, withExtension: "js") else {
            throw BootstrapError.bundleNotFound(name: configuration.sharedCoreBundleName)
        }
        let data = try Data(contentsOf: scriptURL)
        guard let script = String(data: data, encoding: .utf8) else {
            throw BootstrapError.invalidEncoding
        }
        let runtime = SharedRuntimeRegistry.shared.runtime
        try runtime.evaluate(script)
        runtime.installNativeBridge(configuration.nativeBridge)
        hasLoadedBundle = true
    }
}

public enum BootstrapError: Error, LocalizedError {
    case bundleNotFound(name: String)
    case invalidEncoding

    public var errorDescription: String? {
        switch self {
        case .bundleNotFound(let name):
            return "Shared core bundle not found: \(name)"
        case .invalidEncoding:
            return "Shared core bundle has invalid UTF-8 encoding"
        }
    }
}

public protocol EnvironmentConfigurationProviding {
    var sharedCoreBundleName: String { get }
    var nativeBridge: SharedCoreNativeBridge { get }
    var apiBaseURL: URL { get }
    var websocketURL: URL { get }
    var extraEnvironment: [String: String] { get }
}

public final class SharedRuntimeRegistry {
    public static let shared = SharedRuntimeRegistry()
    public private(set) var runtime: SharedRuntime

    private init(runtime: SharedRuntime = SharedRuntime()) {
        self.runtime = runtime
    }

    public func register(runtime: SharedRuntime) {
        self.runtime = runtime
    }
}
