# ListIt

ListIt is a dual-platform marketplace application with a Node/Express backend, a modular web frontend, and a native SwiftUI iOS client that reuses the shared JavaScript core. The repository roots contain documentation and tooling to help you stand up each surface.

## Getting Started on macOS

If you want to run the native app inside the Xcode Simulator, follow the [macOS simulator setup guide](docs/ios-macos-setup.md). The guide walks through installing the correct Node.js version, generating the iOS workspace with XcodeGen, configuring environment files, and launching the `ListItApp` scheme in Xcode.

For additional architectural details, explore:

- [`docs/ios-workspace-architecture.md`](docs/ios-workspace-architecture.md) – Native project layout and module overview.
- [`docs/dual-platform-roadmap.md`](docs/dual-platform-roadmap.md) – How the web and iOS clients evolve together.
- [`docs/backend-contracts.md`](docs/backend-contracts.md) – API contracts consumed by both clients.
