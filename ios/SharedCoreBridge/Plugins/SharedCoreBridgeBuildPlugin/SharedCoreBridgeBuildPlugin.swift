import PackagePlugin
import Foundation

@main
struct SharedCoreBridgeBuildPlugin: BuildToolPlugin {
    func createBuildCommands(context: PluginContext, target: Target) throws -> [Command] {
        guard let target = target as? SourceModuleTarget else { return [] }

        return try buildCommands(targetDirectory: target.directory, pluginWorkDirectory: context.pluginWorkDirectory)
    }
}

#if canImport(XcodeProjectPlugin)
import XcodeProjectPlugin

extension SharedCoreBridgeBuildPlugin: XcodeBuildToolPlugin {
    func createBuildCommands(context: XcodePluginContext, target: XcodeTarget) throws -> [Command] {
        try buildCommands(targetDirectory: target.directory, pluginWorkDirectory: context.pluginWorkDirectory)
    }
}
#endif

private func buildCommands(targetDirectory: Path, pluginWorkDirectory: Path) throws -> [Command] {
    let sourcesDirectory = targetDirectory.removingLastComponent()
    let packageDirectory = sourcesDirectory.removingLastComponent()
    let iosDirectory = packageDirectory.removingLastComponent()
    let repositoryRoot = iosDirectory.removingLastComponent()

    let scriptPath = repositoryRoot
        .appending("scripts")
        .appending("build-core.js")

    guard FileManager.default.fileExists(atPath: scriptPath.string) else {
        throw PluginError.missingBuildScript(scriptPath.string)
    }

    let stampPath = pluginWorkDirectory.appending("build-core.stamp")

    return [
        .prebuildCommand(
            displayName: "Generate shared core JavaScript bundle",
            executable: Path("/usr/bin/env"),
            arguments: ["node", scriptPath.string, "--stamp", stampPath.string],
            environment: [:],
            outputFilesDirectory: pluginWorkDirectory
        )
    ]
}

enum PluginError: Error, CustomStringConvertible {
    case missingBuildScript(String)

    var description: String {
        switch self {
        case .missingBuildScript(let path):
            return "SharedCoreBridge build script not found at \(path)"
        }
    }
}
