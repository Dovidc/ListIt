# ListIt iOS Workspace

This directory seeds the native iOS project infrastructure described in Step 5 of the dual-platform roadmap. The
workspace favors a fully native SwiftUI implementation while reusing the shared JavaScript business logic published
from the web application.

## Contents

- `project.yml` – XcodeGen specification that mirrors the web feature boundaries and outputs the Xcode workspace.
- `SharedCoreBridge/` – Swift Package that exposes the shared JavaScript bundle through XCFramework and JavaScriptCore
  runtime entry points.
- `Services/` – Thin Swift service layer for auth, listings, and uploads.
- `DesignSystem/` – Native-first typography, color, spacing, and component primitives with playground previews for rapid
  customization.
- `PlatformCapabilities/` – Event-driven adapters that translate shared core signals into iOS-only affordances like haptics,
  Live Activities, widgets, and App Intents.
- `Config/` – Environment configuration utilities shared by app targets and Fastlane lanes.
- `FastlaneSupport/` – Fastlane configuration and metadata.
- `.env.example` – Canonical environment variables shared with the Node/Express backend.

### Native-First State Management

- **Keychain-backed Auth** – `AuthService` persists access and refresh tokens using the system Keychain so credentials stay
  synchronized with other native surfaces and remain protected by Secure Enclave policies.
- **CoreData Listings Cache** – `CoreDataListingsPersistence` mirrors the shared listing summaries inside a Core Data store,
  enabling offline reads and future Spotlight/Siri integrations without round-tripping through JavaScript.

## Bootstrapping the Workspace

> Looking for a complete macOS checklist? Follow the step-by-step setup guide in [`docs/ios-macos-setup.md`](../docs/ios-macos-setup.md) to prepare your machine before generating the workspace.

1. Install tooling:
   ```bash
   brew install xcodegen fastlane
   ```

   If Homebrew reports that the `xcodegen` formula requires Xcode 15.3 (a
   common issue on macOS 13 machines that must stay on Xcode 14), run the
   provided installer to download a compatible binary directly from the
   upstream release archives:

   ```bash
   npm run ios:ensure-xcodegen
   ```

   The script installs the binary into `/usr/local/bin` (or falls back to
   `~/.local/bin`) and honors the `LISTIT_XCODEGEN_VERSION`,
   `LISTIT_XCODEGEN_INSTALL_DIR`, and `LISTIT_XCODEGEN_URL` environment
   variables if you need a different release or custom location.
2. Generate the workspace and projects:
   ```bash
   cd ios
   xcodegen generate
   ```
3. Install Ruby gems required by Fastlane:
   ```bash
   bundle install
   ```
4. Open the generated workspace:
   ```bash
   open ListIt.xcworkspace
   ```

### Preserving Local Signing Overrides

- All targets import `Config/Signing.xcconfig`, which seeds default bundle identifiers and the shared development team.
- Create `ios/Config/Signing.local.xcconfig` (this file is gitignored) to override values like `LISTIT_APP_BUNDLE_IDENTIFIER` or `LISTIT_DEVELOPMENT_TEAM` so your personal settings survive future `xcodegen generate` runs and pull requests.
- For example:
  ```xcconfig
  LISTIT_APP_BUNDLE_IDENTIFIER = com.yourcompany.listit
  LISTIT_BUNDLE_PREFIX = com.yourcompany.listit
  LISTIT_DEVELOPMENT_TEAM = ABC1234567
  ```
- `Signing.local.xcconfig` is included only when present, allowing each contributor to keep device provisioning details out of version control while avoiding repeated manual edits in Xcode.

## Shared Core Integration

The workspace expects the web build to produce a distributable JavaScript bundle under `packages/core/dist`. The
`SharedCoreBridge` package can either embed the bundle directly for JavaScriptCore execution or link against a
precompiled XCFramework emitted by the web build pipeline. See the inline documentation in `SharedCoreBridge` for
usage details.

### Selecting the Shared Core Distribution

The native project now supports both embedded scripts and XCFramework distributions so teams can pick the option that
offers the highest level of iOS-specific customization:

- Set `LISTIT_CORE_DISTRIBUTION=embedded` (default) to ship the JavaScript bundle packaged with the app for rapid
  iteration.
- Set `LISTIT_CORE_DISTRIBUTION=xcframework` and point `LISTIT_CORE_XCFRAMEWORK_PATH` to the extracted XCFramework on
  disk when you want to integrate the shared core through Swift Package Manager with maximum native flexibility.
- Use `LISTIT_CORE_BUNDLE_PATH` to bypass discovery entirely and load a specific JavaScript file, which is useful for
  local development builds or specialized QA scenarios.

All variables can be supplied through `.env`, the Fastlane pipeline, or scheme-specific configuration files.

### Environment Variants & Overrides

- Set `LISTIT_ENV` (e.g., `production`, `staging`, `qa`) to load additional overlays. Matching files in
  `Resources/Config` such as `app.production.env` automatically extend the base configuration while keeping values in the
  shared bundle (`Sources/SharedServices/Resources`).
- Provide project-level overrides by adding `.env.production` (or `.env-production`) next to the standard `.env`. When the
  variant-specific file is absent the loader falls back to `.env.example.production` and only fills missing keys.
- For bespoke build pipelines, point `LISTIT_IOS_ENV_PATH_<VARIANT>` (for example `LISTIT_IOS_ENV_PATH_PRODUCTION`) to a
  directory or file that should override the discovered variant values. Directory targets are inspected for common file
  names such as `app.production.env` so teams can organize configuration however they prefer.

## Design System & Theming

- `DesignSystem/` exposes `DesignSystemTheme` and a SwiftUI `DesignSystemProvider` that wraps any view hierarchy with brand
  colors, typography, spacing, and component styles. Teams can override theme tokens via `.env` or scheme-based configuration
  files (`LISTIT_IOS_THEME_*`) without touching source code.
- UIKit chrome now consumes the same tokens: `AppearanceConfigurator` translates the active typography scale into navigation bar,
  tab bar, and toolbar fonts so per-scheme overrides stay consistent across SwiftUI and UIKit surfaces.
- Theme tokens accept granular overrides so product teams can reskin ListIt without recompiling JavaScript:
  - **Colors** – `LISTIT_IOS_THEME_PRIMARY`, `SECONDARY`, `ACCENT`, `BACKGROUND`, `SURFACE`, `ON_PRIMARY`, `ON_SECONDARY`,
    `ON_BACKGROUND`, `ON_SURFACE`, `SUCCESS`, `WARNING`, `DANGER`.
  - **Spacing** – override individual values with `LISTIT_IOS_THEME_SPACING_XSMALL`, `SMALL`, `MEDIUM`, `LARGE`, and
    `XLARGE`, or set a base multiplier via `LISTIT_IOS_THEME_BASE_SPACING`.
  - **Corners** – control each radius with `LISTIT_IOS_THEME_CORNER_RADIUS_SMALL`, `MEDIUM`, and `LARGE`, or apply a base
    curve using `LISTIT_IOS_THEME_CORNER_RADIUS`.
  - **Typography** – choose presets with `LISTIT_IOS_THEME_TYPOGRAPHY_PRESET` (`rounded`, `system`, `serif`, `monospaced`,
    `editorial`) and layer overrides on top using `LISTIT_IOS_THEME_FONT_GLOBAL`, category keys (`FONT_DISPLAY`, `FONT_CONTENT`,
    `FONT_META`), or per-style tokens such as `LISTIT_IOS_THEME_FONT_HEADLINE`. Override strings use
    `key=value` pairs separated by commas/semicolons (e.g., `family=GT Walsheim;weight=bold;scale=1.05`).
- `ThemePlaygroundView` ships as a SwiftUI preview that designers can open inside Xcode to tweak palettes, spacing, and
  interactions. The live preview mirrors production components (cards, primary/secondary buttons) and now surfaces sliders for
  spacing, corner radii, typography presets, and status colors so visual polish remains consistent across web and native.
- `.env.example` in the workspace root enumerates every override key (palette, spacing, corners, typography) so product variants
  can start from a single template and adjust only the values that differ from the defaults.
- Global UIKit chrome (navigation bars, tab bars, toolbars) inherits the active `DesignSystemTheme`, which keeps large titles,
  tint colors, and selection states synchronized with the SwiftUI layer.
- Feature modules consume the design system through the SwiftUI environment. For example, `AuthFeatureView` and
  `ListingsFeatureView` render `ListItCard` instances, primary buttons, and dynamic typography to guarantee platform idioms
  like large navigation titles, swipe actions, and dynamic type scaling remain configurable.

## Native Capability Shims

- `PlatformCapabilities/` defines lightweight protocols (`HapticsProviding`, `LiveActivityManaging`, `WidgetScheduling`,
  `IntentHandling`) and a `CapabilityRouter` that listens for shared-core events. The router can be toggled via environment
  flags (`LISTIT_IOS_ENABLE_*`) to mirror deployment requirements.
- `SharedCoreNativeBridge` now supports `emitEvent` so JavaScript modules can trigger native behaviors without leaking
  platform-specific code back into the shared bundle. `AppEnvironment` wires the bridge to the router, ensuring actions like
  “favorite listing” or “upload complete” produce haptics, Live Activity updates, or widget refreshes.
- Because the router is injectable, product teams can drop in bespoke implementations (e.g., Core Haptics waveforms,
  WidgetKit timelines) per build variant while leaving feature modules untouched.

## Customization Workflow Artifacts

- Launch `ThemePlaygroundView` or add it to an internal scheme to experiment with new palettes alongside snapshot tests.
- Feature tabs fire `CapabilityEvent`s whenever meaningful milestones occur (successful sign-in, upload completion, swipe
  gestures). These events flow through the router so QA can validate haptics or Live Activities in isolation.
- Designers can check in alternative theme presets by extending `.env.production` or other variant files—CI will load the same
  configuration during Fastlane-driven UI tests.

## Continuous Integration

Fastlane lanes and the GitHub Actions workflow ensure `xcodebuild test` runs on pull requests and that archives are
produced for TestFlight on main branch merges. Both rely on the same `.env` contract as the Node backend, keeping
configuration aligned across platforms.
