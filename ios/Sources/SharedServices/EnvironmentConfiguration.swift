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
    public init(
        fileManager: FileManager = .default,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        resourceBundle: Bundle = Bundle(for: BundleLocator.self),
        appBundle: Bundle = .main
    ) {
        self.fileManager = fileManager
        self.environment = environment
        self.resourceBundle = resourceBundle
        self.appBundle = appBundle
    }

    private let fileManager: FileManager
    private let environment: [String: String]
    private let resourceBundle: Bundle
    private let appBundle: Bundle

    public func load() throws -> [String: String] {
        var values: [String: String] = [:]

        try mergeResource(named: "default", subdirectory: nil, from: resourceBundle, into: &values)
        try mergeAppResource(named: "app", into: &values)

        if let overridesPath = environment["LISTIT_IOS_ENV_PATH"], !overridesPath.isEmpty {
            try mergeGeneralOverride(at: overridesPath, into: &values)
        }

        let projectEnv = URL(fileURLWithPath: "../ios/.env")
        if fileManager.fileExists(atPath: projectEnv.path) {
            try mergeFile(at: projectEnv, into: &values)
        } else {
            let exampleEnv = URL(fileURLWithPath: "../ios/.env.example")
            if fileManager.fileExists(atPath: exampleEnv.path) {
                try mergeFile(at: exampleEnv, into: &values)
            }
        }

        let variant = resolvedVariant(existingValues: values)
        if let variant {
            try mergeVariant(named: variant, into: &values)
        }

        if values.isEmpty {
            throw EnvironmentError.missingConfiguration
        }

        return values
    }

    private func mergeVariant(named variant: String, into values: inout [String: String]) throws {
        var visited = Set<URL>()

        func merge(url: URL?) throws {
            guard let url else { return }
            if visited.contains(url) { return }
            if url.isFileURL, !fileManager.fileExists(atPath: url.path) { return }
            try values.merge(parse(url: url)) { _, new in new }
            visited.insert(url)
        }

        for bundle in [appBundle, resourceBundle] {
            try merge(url: bundle.url(forResource: "app.\(variant)", withExtension: "env"))
            try merge(url: bundle.url(forResource: "app-\(variant)", withExtension: "env"))
            try merge(url: bundle.url(forResource: "app.\(variant)", withExtension: "env", subdirectory: "Config"))
            try merge(url: bundle.url(forResource: "app-\(variant)", withExtension: "env", subdirectory: "Config"))
            try merge(url: bundle.url(forResource: "default.\(variant)", withExtension: "env"))
            try merge(url: bundle.url(forResource: "default-\(variant)", withExtension: "env"))
        }

        let projectBase = URL(fileURLWithPath: "../ios")
        let projectVariantCandidates = [
            projectBase.appendingPathComponent(".env.\(variant)"),
            projectBase.appendingPathComponent(".env-\(variant)")
        ]

        var hasProjectVariant = false
        for url in projectVariantCandidates {
            if fileManager.fileExists(atPath: url.path) {
                hasProjectVariant = true
                try merge(url: url)
            }
        }

        if !hasProjectVariant {
            let exampleCandidates = [
                projectBase.appendingPathComponent(".env.example.\(variant)"),
                projectBase.appendingPathComponent(".env.example-\(variant)")
            ]
            for url in exampleCandidates {
                if fileManager.fileExists(atPath: url.path) {
                    if visited.contains(url) { continue }
                    let parsed = try parse(url: url)
                    values.merge(parsed) { current, _ in current }
                    visited.insert(url)
                }
            }
        }

        if let variantOverride = variantOverridePath(for: variant) {
            for url in expandOverridePath(variantOverride, variant: variant) {
                try merge(url: url)
            }
        }
    }

    private func mergeAppResource(named name: String, into values: inout [String: String]) throws {
        if let url = appBundle.url(forResource: name, withExtension: "env") {
            try values.merge(parse(url: url)) { _, new in new }
            return
        }

        if let url = appBundle.url(forResource: name, withExtension: "env", subdirectory: "Config") {
            try values.merge(parse(url: url)) { _, new in new }
            return
        }

        try mergeResource(named: name, subdirectory: nil, from: resourceBundle, into: &values)
    }

    private func mergeResource(named name: String, subdirectory: String?, from bundle: Bundle, into values: inout [String: String]) throws {
        if let url = bundle.url(forResource: name, withExtension: "env", subdirectory: subdirectory) {
            try values.merge(parse(url: url)) { _, new in new }
        }
    }

    private func mergeGeneralOverride(at path: String, into values: inout [String: String]) throws {
        let url = URL(fileURLWithPath: path)
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            return
        }

        if !isDirectory.boolValue {
            try mergeFile(at: url, into: &values)
            return
        }

        let candidateNames = [
            "app.env",
            ".env",
            "default.env"
        ]

        for candidate in candidateNames {
            let candidateURL = url.appendingPathComponent(candidate)
            if fileManager.fileExists(atPath: candidateURL.path) {
                try mergeFile(at: candidateURL, into: &values)
            }
        }
    }

    private func mergeFile(atPath path: String, into values: inout [String: String]) throws {
        let url = URL(fileURLWithPath: path)
        try mergeFile(at: url, into: &values)
    }

    private func mergeFile(at url: URL, into values: inout [String: String]) throws {
        values.merge(try parse(url: url)) { _, new in new }
    }

    private func parse(url: URL) throws -> [String: String] {
        let data = try Data(contentsOf: url)
        guard let content = String(data: data, encoding: .utf8) else {
            throw EnvironmentError.invalidEncoding
        }
        return parse(content: content)
    }

    private func resolvedVariant(existingValues: [String: String]) -> String? {
        if let explicit = normalizedVariant(from: environment["LISTIT_ENV"]) {
            return explicit
        }
        if let derived = normalizedVariant(from: existingValues["LISTIT_ENV"]) {
            return derived
        }
        return nil
    }

    private func normalizedVariant(from value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func variantOverridePath(for variant: String) -> String? {
        let normalized = variant
            .uppercased()
            .map { character -> Character in
                if character.isLetter || character.isNumber { return character }
                return "_"
            }
        let key = "LISTIT_IOS_ENV_PATH_\(String(normalized))"
        if let value = environment[key], !value.isEmpty {
            return value
        }
        return nil
    }

    private func expandOverridePath(_ path: String, variant: String) -> [URL] {
        let baseURL = URL(fileURLWithPath: path)
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: baseURL.path, isDirectory: &isDirectory) else {
            return []
        }
        if !isDirectory.boolValue {
            return [baseURL]
        }

        let candidateNames = [
            ".env.\(variant)",
            ".env-\(variant)",
            "app.\(variant).env",
            "app-\(variant).env",
            "\(variant).env"
        ]

        return candidateNames
            .map { baseURL.appendingPathComponent($0) }
            .filter { fileManager.fileExists(atPath: $0.path) }
    }
}

private func parse(content: String) -> [String: String] {
    content
        .split(whereSeparator: \.isNewline)
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

final class BundleLocator {}
