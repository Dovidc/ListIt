# ListIt iOS Workspace

This directory seeds the native iOS project infrastructure described in Step 5 of the dual-platform roadmap. The
workspace favors a fully native SwiftUI implementation while reusing the shared JavaScript business logic published
from the web application.

## Contents

- `project.yml` – XcodeGen specification that mirrors the web feature boundaries and outputs the Xcode workspace.
- `SharedCoreBridge/` – Swift Package that exposes the shared JavaScript bundle through XCFramework and JavaScriptCore
  runtime entry points.
- `Services/` – Thin Swift service layer for auth, listings, and uploads.
- `Config/` – Environment configuration utilities shared by app targets and Fastlane lanes.
- `FastlaneSupport/` – Fastlane configuration and metadata.
- `.env.example` – Canonical environment variables shared with the Node/Express backend.

### Native-First State Management

- **Keychain-backed Auth** – `AuthService` persists access and refresh tokens using the system Keychain so credentials stay
  synchronized with other native surfaces and remain protected by Secure Enclave policies.
- **CoreData Listings Cache** – `CoreDataListingsPersistence` mirrors the shared listing summaries inside a Core Data store,
  enabling offline reads and future Spotlight/Siri integrations without round-tripping through JavaScript.

## Bootstrapping the Workspace

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

## Continuous Integration

Fastlane lanes and the GitHub Actions workflow ensure `xcodebuild test` runs on pull requests and that archives are
produced for TestFlight on main branch merges. Both rely on the same `.env` contract as the Node backend, keeping
configuration aligned across platforms.
