# iOS Workspace Architecture

The `ios/` directory introduces the Xcode workspace that supports the fully native SwiftUI implementation of ListIt while
leveraging the shared JavaScript business logic.

## Targets and Modules

| Target | Type | Responsibility |
| --- | --- | --- |
| `ListItApp` | Application | SwiftUI entry point, environment bootstrap, feature tab composition. |
| `AuthFeature`, `ListingsFeature`, `UploadFeature` | Frameworks | Native feature surfaces aligned with the web feature boundaries. |
| `SharedServices` | Framework | Thin Swift services that delegate complex logic to the shared JavaScript runtime and manage environment configuration. |
| `SharedCoreBridge` | Swift Package | JavaScriptCore bridge with both runtime execution and XCFramework linking options. |

The workspace layout mirrors the mental model of the web client, making it easier to port screens incrementally.

## Shared Core Integration

- `SharedCoreBridge` loads the compiled `listit-core.js` bundle at runtime and exposes Swift-friendly service entry points.
- `SharedRuntimeRegistry` lets tests inject a mock runtime while the application uses the default JavaScriptCore context.
- Services (`AuthService`, `ListingsService`, `UploadService`) bind to JavaScript functions following the naming contract
  established in the shared core package.

## Environment Management

`EnvironmentConfiguration` merges configuration from three sources in priority order:

1. Built-in defaults embedded as `default.env` alongside the `SharedServices` framework.
2. `app.env` packaged with the application (per-scheme overrides such as staging vs. production).
3. Developer overrides via the `LISTIT_IOS_ENV_PATH` environment variable, pointing to a local `.env` file.

This strategy keeps the iOS build aligned with the Node/Express `.env` contract while still allowing scheme-specific overrides.

## Continuous Integration

Fastlane lanes (`ci_tests`, `beta`) are set up under `ios/FastlaneSupport`, and the GitHub Actions workflow `.github/workflows/ios-ci.yml`
executes them on macOS runners. The workflow installs XcodeGen, generates the workspace, runs unit tests, and archives
builds on main branch pushes for TestFlight distribution.

## Next Steps

- Wire the services to the actual shared core bundle once the TypeScript modules land in `packages/core`.
- Expand unit/UI coverage with XCTest and XCUITest suites for feature flows.
- Integrate real authentication and upload endpoints using the backend contracts documented in `docs/backend-contracts.md`.
