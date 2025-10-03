// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SharedCoreBridge",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(
            name: "SharedCoreBridge",
            targets: ["SharedCoreBridge"]
        )
    ],
    targets: [
        .target(
            name: "SharedCoreBridge",
            resources: [
                .process("Resources")
            ],
            plugins: [
                .plugin(name: "SharedCoreBridgeBuildPlugin")
            ]
        ),
        .testTarget(
            name: "SharedCoreBridgeTests",
            dependencies: [
                "SharedCoreBridge",
                .target(name: "SharedCoreBridgeBuildPlugin")
            ]
        ),
        .testTarget(
            name: "SharedCoreBridgeBuildPluginTests",
            dependencies: [
                .target(name: "SharedCoreBridgeBuildPlugin")
            ]
        ),
        .plugin(
            name: "SharedCoreBridgeBuildPlugin",
            capability: .buildTool()
        )
    ]
)
