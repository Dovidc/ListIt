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

## Bootstrapping the Workspace

1. Install tooling:
   ```bash
   brew install xcodegen fastlane
   ```
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

## Continuous Integration

Fastlane lanes and the GitHub Actions workflow ensure `xcodebuild test` runs on pull requests and that archives are
produced for TestFlight on main branch merges. Both rely on the same `.env` contract as the Node backend, keeping
configuration aligned across platforms.
