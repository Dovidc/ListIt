import Foundation

public protocol SharedCoreBundleProviding {
    func loadScript(named bundleName: String, configuration: EnvironmentConfigurationProviding) throws -> String
}

public struct SharedCoreBundleProvider: SharedCoreBundleProviding {
    private let fileManager: FileManager
    private let resourceBundle: Bundle

    public init(fileManager: FileManager = .default, resourceBundle: Bundle = .module) {
        self.fileManager = fileManager
        self.resourceBundle = resourceBundle
    }

    public func loadScript(named bundleName: String, configuration: EnvironmentConfigurationProviding) throws -> String {
        if let overridePath = configuration.extraEnvironment["LISTIT_CORE_BUNDLE_PATH"],
           let script = try? loadScript(fromFilesystemPath: overridePath, bundleName: bundleName) {
            return script
        }

        if shouldPreferXCFramework(using: configuration),
           let xcframeworkScript = try? loadScriptFromXCFramework(configuration: configuration, bundleName: bundleName) {
            return xcframeworkScript
        }

        if let script = try? loadScriptFromMainBundle(bundleName: bundleName) {
            return script
        }

        if let script = try? loadScriptFromPackageBundle(bundleName: bundleName) {
            return script
        }

        throw BootstrapError.bundleNotFound(name: bundleName)
    }
}

private extension SharedCoreBundleProvider {
    func shouldPreferXCFramework(using configuration: EnvironmentConfigurationProviding) -> Bool {
        guard let value = configuration.extraEnvironment["LISTIT_CORE_DISTRIBUTION"]?.lowercased() else {
            return false
        }
        return value == "xcframework"
    }

    func loadScript(fromFilesystemPath path: String, bundleName: String) throws -> String {
        var url = URL(fileURLWithPath: path)
        var isDirectory: ObjCBool = false
        if fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
            url.appendPathComponent("\(bundleName).js")
        }
        return try loadScript(from: url)
    }

    func loadScriptFromXCFramework(configuration: EnvironmentConfigurationProviding, bundleName: String) throws -> String {
        if let explicitPath = configuration.extraEnvironment["LISTIT_CORE_XCFRAMEWORK_PATH"],
           !explicitPath.isEmpty,
           let script = try? loadScriptInsideXCFramework(at: URL(fileURLWithPath: explicitPath), bundleName: bundleName) {
            return script
        }

        if let autoDiscovered = autoDiscoverXCFramework(bundleName: bundleName) {
            return try loadScriptInsideXCFramework(at: autoDiscovered, bundleName: bundleName)
        }

        throw BootstrapError.bundleNotFound(name: "\(bundleName) (xcframework)")
    }

    func loadScriptInsideXCFramework(at url: URL, bundleName: String) throws -> String {
        guard fileManager.fileExists(atPath: url.path) else {
            throw BootstrapError.bundleNotFound(name: "\(bundleName) (xcframework)")
        }

        if let enumerator = fileManager.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey]) {
            for case let fileURL as URL in enumerator {
                if fileURL.lastPathComponent == "\(bundleName).js" {
                    return try loadScript(from: fileURL)
                }
            }
        }

        throw BootstrapError.bundleNotFound(name: "\(bundleName) (xcframework)")
    }

    func autoDiscoverXCFramework(bundleName: String) -> URL? {
        let searchURLs: [URL] = [
            resourceBundle.resourceURL,
            Bundle.main.privateFrameworksURL,
            Bundle.main.bundleURL
        ].compactMap { $0 }

        for baseURL in searchURLs {
            if let enumerator = fileManager.enumerator(at: baseURL, includingPropertiesForKeys: [.isDirectoryKey]) {
                for case let candidate as URL in enumerator {
                    if candidate.pathExtension == "xcframework" && candidate.lastPathComponent.localizedCaseInsensitiveContains(bundleName) {
                        return candidate
                    }
                }
            }
        }
        return nil
    }

    func loadScriptFromMainBundle(bundleName: String) throws -> String? {
        guard let url = Bundle.main.url(forResource: bundleName, withExtension: "js") else { return nil }
        return try loadScript(from: url)
    }

    func loadScriptFromPackageBundle(bundleName: String) throws -> String? {
        guard let url = resourceBundle.url(forResource: bundleName, withExtension: "js") else { return nil }
        return try loadScript(from: url)
    }

    func loadScript(from url: URL) throws -> String {
        let data = try Data(contentsOf: url)
        guard let script = String(data: data, encoding: .utf8) else {
            throw BootstrapError.invalidEncoding
        }
        return script
    }
}
