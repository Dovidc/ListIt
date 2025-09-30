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

## Design System & Customization

- The `DesignSystem` module exposes `DesignSystemTheme` and a SwiftUI `DesignSystemProvider` so native screens can opt into the
  same color, typography, spacing, and corner radius tokens. Teams override any token via `.env` or scheme-specific files using
  the shared `LISTIT_IOS_THEME_*` contract.
- Palette tokens cover both background hues and readable text pairings. Alongside the base colors (`PRIMARY`, `SECONDARY`,
  `ACCENT`, `BACKGROUND`, `SURFACE`) the loader honours content-focused overrides (`ON_PRIMARY`, `ON_SECONDARY`,
  `ON_BACKGROUND`, `ON_SURFACE`) so teams can swap button text, navigation chrome, and card copy colors without editing Swift
  code.
- UIKit chrome inherits those tokens automatically. `AppearanceConfigurator` converts the active typography scale into UIKit
  fonts so navigation bars, tab bars, toolbars, and bar button items mirror the SwiftUI look without manual tweaking.
- The `.env.example` template enumerates every customizable key—from palette overrides to typography descriptors—so product
  variants (production, staging, white-label) can copy the file and tune values without code changes.
- `ThemePlaygroundView` (available under `DesignSystem/Theming`) offers a live SwiftUI preview with controls for colors,
  spacing, typography presets, and interaction toggles, enabling designers to experiment before checking updated tokens into
  source control.

## Continuous Integration

Fastlane lanes (`ci_tests`, `beta`) are set up under `ios/FastlaneSupport`, and the GitHub Actions workflow `.github/workflows/ios-ci.yml`
executes them on macOS runners. The workflow installs XcodeGen, generates the workspace, runs unit tests, and archives
builds on main branch pushes for TestFlight distribution.

## Next Steps

- Wire the services to the actual shared core bundle once the TypeScript modules land in `packages/core`.
- Expand unit/UI coverage with XCTest and XCUITest suites for feature flows.
- Integrate real authentication and upload endpoints using the backend contracts documented in `docs/backend-contracts.md`.
