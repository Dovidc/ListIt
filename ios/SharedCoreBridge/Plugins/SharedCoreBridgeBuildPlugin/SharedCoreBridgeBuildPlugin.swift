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

private func resolveNodeExecutable(fileManager: FileManager = .default) throws -> Path {
    let environment = ProcessInfo.processInfo.environment
    var searchPaths: [String] = []

    if let pathVariable = environment["PATH"] {
        searchPaths.append(contentsOf: pathVariable.split(separator: ":").map(String.init))
    }

    searchPaths.append(contentsOf: [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin"
    ])

    for directory in searchPaths {
        let candidate = Path(directory).appending("node")
        if fileManager.isExecutableFile(atPath: candidate.string) {
            return candidate
        }
    }

    throw PluginError.missingNodeExecutable
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
