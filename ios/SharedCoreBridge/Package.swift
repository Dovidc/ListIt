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
            dependencies: ["SharedCoreBridge"]
        ),
        .plugin(
            name: "SharedCoreBridgeBuildPlugin",
            capability: .buildTool()
        )
    ]
)
