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
            ]
        ),
        .testTarget(
            name: "SharedCoreBridgeTests",
            dependencies: ["SharedCoreBridge"]
        )
    ]
)
