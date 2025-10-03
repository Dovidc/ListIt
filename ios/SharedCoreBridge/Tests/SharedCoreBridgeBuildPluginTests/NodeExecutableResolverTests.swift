import XCTest
@testable import SharedCoreBridgeBuildPlugin

final class NodeExecutableResolverTests: XCTestCase {
    func testResolvesNodeFromNvmVersionDirectory() throws {
        let home = "/Users/listit"
        let version = "v18.20.8"
        let versionsRoot = "\(home)/.nvm/versions/node"
        let nvmBin = "\(versionsRoot)/\(version)/bin"
        let nodePath = "\(nvmBin)/node"

        let fileManager = StubFileManager(
            executablePaths: [nodePath],
            existingDirectories: [versionsRoot, "\(versionsRoot)/\(version)", nvmBin],
            directoryContents: [versionsRoot: [version]]
        )

        let resolved = try resolveNodeExecutable(
            environment: [
                "HOME": home,
                "PATH": "/usr/bin"
            ],
            fileManager: fileManager
        )

        XCTAssertEqual(resolved.string, nodePath)
    }

    func testHonorsListItNodeBinaryOverride() throws {
        let overridePath = "/custom/bin/node"
        let fileManager = StubFileManager(executablePaths: [overridePath])

        let resolved = try resolveNodeExecutable(
            environment: [
                "LISTIT_NODE_BINARY": overridePath,
                "PATH": "/usr/bin"
            ],
            fileManager: fileManager
        )

        XCTAssertEqual(resolved.string, overridePath)
    }
}

private final class StubFileManager: FileManager {
    private let executablePaths: Set<String>
    private let existingDirectories: Set<String>
    private let directoryContents: [String: [String]]

    init(
        executablePaths: Set<String>,
        existingDirectories: Set<String> = [],
        directoryContents: [String: [String]] = [:]
    ) {
        self.executablePaths = executablePaths
        self.existingDirectories = existingDirectories
        self.directoryContents = directoryContents
    }

    override func isExecutableFile(atPath path: String) -> Bool {
        executablePaths.contains(path)
    }

    override func fileExists(atPath path: String, isDirectory: UnsafeMutablePointer<ObjCBool>?) -> Bool {
        if executablePaths.contains(path) {
            isDirectory?.pointee = false
            return true
        }

        if existingDirectories.contains(path) || directoryContents.keys.contains(path) {
            isDirectory?.pointee = true
            return true
        }

        isDirectory?.pointee = false
        return false
    }

    override func contentsOfDirectory(atPath path: String) throws -> [String] {
        directoryContents[path] ?? []
    }
}
