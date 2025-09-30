import Foundation
import Combine
import SharedCoreBridge

public final class EnvironmentConfiguration: ObservableObject {
    @Published public private(set) var environment: [String: String] = [:]

    public init(loader: EnvironmentLoading = DefaultEnvironmentLoader()) {
        self.loader = loader
    }

    private let loader: EnvironmentLoading
}

extension EnvironmentConfiguration {
    public func load() throws {
        environment = try loader.load()
    }
}

extension EnvironmentConfiguration: EnvironmentConfigurationProviding {
    public var sharedCoreBundleName: String { "listit-core" }

    public var nativeBridge: SharedCoreNativeBridge {
        SharedCoreNativeBridge(environment: self)
    }

    public var apiBaseURL: URL {
        URL(string: environment["API_BASE_URL"] ?? "") ?? URL(string: "https://localhost")!
    }

    public var websocketURL: URL {
        URL(string: environment["WEBSOCKET_URL"] ?? "") ?? URL(string: "wss://localhost")!
    }

    public var extraEnvironment: [String: String] {
        environment
    }
}

extension EnvironmentConfiguration {
    public func value(for key: String) -> String? {
        environment[key]
    }
}

public protocol EnvironmentLoading {
    func load() throws -> [String: String]
}

public struct DefaultEnvironmentLoader: EnvironmentLoading {
    public init(fileManager: FileManager = .default, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.fileManager = fileManager
        self.environment = environment
    }

    private let fileManager: FileManager
    private let environment: [String: String]

    public func load() throws -> [String: String] {
        var values: [String: String] = [:]

        let bundle = Bundle(for: BundleLocator.self)
        if let defaultEnvURL = bundle.url(forResource: "default", withExtension: "env") {
            values.merge(try parse(url: defaultEnvURL)) { _, new in new }
        }

        if let bundleURL = Bundle.main.url(forResource: "app", withExtension: "env") {
            values.merge(try parse(url: bundleURL)) { _, new in new }
        }

        if let overridesPath = environment["LISTIT_IOS_ENV_PATH"] {
            let overrideURL = URL(fileURLWithPath: overridesPath)
            values.merge(try parse(url: overrideURL)) { _, new in new }
        }

        let projectEnv = URL(fileURLWithPath: "../ios/.env")
        if fileManager.fileExists(atPath: projectEnv.path) {
            values.merge(try parse(url: projectEnv)) { _, new in new }
        } else {
            let exampleEnv = URL(fileURLWithPath: "../ios/.env.example")
            if fileManager.fileExists(atPath: exampleEnv.path) {
                values.merge(try parse(url: exampleEnv)) { _, new in new }
            }
        }

        if values.isEmpty {
            throw EnvironmentError.missingConfiguration
        }

        return values
    }

    private func parse(url: URL) throws -> [String: String] {
        let data = try Data(contentsOf: url)
        guard let content = String(data: data, encoding: .utf8) else {
            throw EnvironmentError.invalidEncoding
        }
        return parse(content: content)
    }
}

private func parse(content: String) -> [String: String] {
    content
        .split(whereSeparator: \n.contains)
        .reduce(into: [String: String]()) { result, line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, !trimmed.hasPrefix("#"), let separatorIndex = trimmed.firstIndex(of: "=") else { return }
            let key = String(trimmed[..<separatorIndex])
            let value = String(trimmed[trimmed.index(after: separatorIndex)...])
            result[key] = value
        }
}

public enum EnvironmentError: Error {
    case invalidEncoding
    case missingConfiguration
}

private final class BundleLocator {}
