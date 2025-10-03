import PackagePlugin
import Foundation

@main
struct SharedCoreBridgeBuildPlugin: BuildToolPlugin {
    func createBuildCommands(context: PluginContext, target: Target) throws -> [Command] {
        guard let target = target as? SourceModuleTarget else { return [] }

        return try buildCommands(
            repositorySearchDirectory: target.directory,
            pluginWorkDirectory: context.pluginWorkDirectory
        )
    }
}

#if canImport(XcodeProjectPlugin)
import XcodeProjectPlugin

extension SharedCoreBridgeBuildPlugin: XcodeBuildToolPlugin {
    func createBuildCommands(context: XcodePluginContext, target: XcodeTarget) throws -> [Command] {
        try buildCommands(
            repositorySearchDirectory: context.xcodeProject.directory,
            pluginWorkDirectory: context.pluginWorkDirectory
        )
    }
}
#endif

private func buildCommands(repositorySearchDirectory: Path, pluginWorkDirectory: Path) throws -> [Command] {
    let repositoryRoot = try resolveRepositoryRoot(startingAt: repositorySearchDirectory)

    let scriptPath = repositoryRoot
        .appending("scripts")
        .appending("build-core.js")

    guard FileManager.default.fileExists(atPath: scriptPath.string) else {
        throw PluginError.missingBuildScript(scriptPath.string)
    }

    let stampPath = pluginWorkDirectory.appending("build-core.stamp")

    let nodeExecutable = try resolveNodeExecutable()

    return [
        .prebuildCommand(
            displayName: "Generate shared core JavaScript bundle",
            executable: nodeExecutable,
            arguments: [scriptPath.string, "--stamp", stampPath.string],
            environment: [:],
            outputFilesDirectory: pluginWorkDirectory
        )
    ]
}

enum PluginError: Error, CustomStringConvertible {
    case missingBuildScript(String)
    case missingNodeExecutable
    case missingRepositoryRoot

    var description: String {
        switch self {
        case .missingBuildScript(let path):
            return "SharedCoreBridge build script not found at \(path)"
        case .missingNodeExecutable:
            return "SharedCoreBridge build plugin could not locate the Node.js executable"
        case .missingRepositoryRoot:
            return "SharedCoreBridge build plugin could not determine the repository root directory"
        }
    }
}

func resolveNodeExecutable(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileManager: FileManager = .default
) throws -> Path {
    for key in ["LISTIT_NODE_BINARY", "NODE_BINARY"] {
        if let override = environment[key], !override.isEmpty {
            if fileManager.isExecutableFile(atPath: override) {
                return Path(override)
            }
            throw PluginError.missingNodeExecutable
        }
    }

    var searchDirectories: [String] = []
    var seen = Set<String>()

    if let pathVariable = environment["PATH"] {
        for directory in pathVariable.split(separator: ":").map(String.init) where seen.insert(directory).inserted {
            searchDirectories.append(directory)
        }
    }

    if let nvmBin = environment["NVM_BIN"], !nvmBin.isEmpty, seen.insert(nvmBin).inserted {
        searchDirectories.append(nvmBin)
    }

    for directory in discoverNvmVersionBins(environment: environment, fileManager: fileManager) where seen.insert(directory).inserted {
        searchDirectories.append(directory)
    }

    for fallback in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] where seen.insert(fallback).inserted {
        searchDirectories.append(fallback)
    }

    for directory in searchDirectories {
        let candidate = Path(directory).appending("node")
        if fileManager.isExecutableFile(atPath: candidate.string) {
            return candidate
        }
    }

    throw PluginError.missingNodeExecutable
}

private func discoverNvmVersionBins(environment: [String: String], fileManager: FileManager) -> [String] {
    let homeDirectory = environment["HOME"] ?? NSHomeDirectory()
    let versionsRoot = Path(homeDirectory)
        .appending(".nvm")
        .appending("versions")
        .appending("node")

    var isDirectory: ObjCBool = false
    guard fileManager.fileExists(atPath: versionsRoot.string, isDirectory: &isDirectory), isDirectory.boolValue else {
        return []
    }

    guard let versionDirectories = try? fileManager.contentsOfDirectory(atPath: versionsRoot.string) else {
        return []
    }

    return versionDirectories.map { version in
        versionsRoot
            .appending(version)
            .appending("bin")
            .string
    }
}

private func resolveRepositoryRoot(startingAt targetDirectory: Path, fileManager: FileManager = .default) throws -> Path {
    if let root = findRepositoryRoot(startingAt: targetDirectory, fileManager: fileManager) {
        return root
    }

    let pluginSourceDirectory = Path(#filePath)
        .removingLastComponent() // SharedCoreBridgeBuildPlugin.swift
        .removingLastComponent() // SharedCoreBridgeBuildPlugin
        .removingLastComponent() // Plugins

    if let root = findRepositoryRoot(startingAt: pluginSourceDirectory, fileManager: fileManager) {
        return root
    }

    throw PluginError.missingRepositoryRoot
}

private func findRepositoryRoot(startingAt path: Path, fileManager: FileManager) -> Path? {
    var current = path

    while true {
        let candidate = current.appending("package.json")
        if fileManager.fileExists(atPath: candidate.string) {
            return current
        }

        let parent = current.removingLastComponent()
        if parent == current {
            return nil
        }

        current = parent
    }
}
